import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs/promises', () => ({
  appendFile: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
}));

import { readFile } from 'fs/promises';
import {
  countGatePassedToday,
  withinPushWindow,
  localDateKey,
  todaySpeaksFile,
} from './push-budget.js';

const readFileMock = vi.mocked(readFile);

describe('push-budget（S11 日预算 + 推送窗口）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('withinPushWindow', () => {
    it('无窗口（null）恒真', () => {
      expect(withinPushWindow(23, null, null)).toBe(true);
    });

    it('窗口外 → false（如 9-22 的 8 点）', () => {
      expect(withinPushWindow(8, 9, 22)).toBe(false);
      expect(withinPushWindow(23, 9, 22)).toBe(false);
    });

    it('窗口内 → true（含端点）', () => {
      expect(withinPushWindow(9, 9, 22)).toBe(true);
      expect(withinPushWindow(15, 9, 22)).toBe(true);
      expect(withinPushWindow(22, 9, 22)).toBe(true);
    });

    it('跨午夜窗口（22-6）：晚 23 点与早 5 点在窗内，正午在窗外', () => {
      expect(withinPushWindow(23, 22, 6)).toBe(true);
      expect(withinPushWindow(5, 22, 6)).toBe(true);
      expect(withinPushWindow(12, 22, 6)).toBe(false);
    });
  });

  describe('日期键（本地日，与文件名同源）', () => {
    it('localDateKey/todaySpeaksFile 本地日期一致', () => {
      // 无偏移的本地时间字符串：断言与进程时区无关
      vi.setSystemTime(new Date('2026-08-15T00:30:00'));
      expect(localDateKey()).toBe('2026-08-15');
      expect(todaySpeaksFile()).toBe('speaks-2026-08-15.jsonl');
    });
  });

  describe('countGatePassedToday（文件即当日，无时间戳比对）', () => {
    it('统计非 gated 非 planLimited 记录；坏行跳过', async () => {
      readFileMock.mockResolvedValue(
        [
          JSON.stringify({ pushed: true, timestamp: '2026-08-15T00:00:00.000Z' }), // 计 1
          JSON.stringify({ gated: true }), // 跳过
          JSON.stringify({ planLimited: true }), // 跳过（被拦不占额度）
          'not json', // 跳过
          JSON.stringify({ pushed: false, timestamp: '2026-08-15T01:00:00.000Z' }), // 计 2（纯 PWA）
        ].join('\n'),
      );
      expect(await countGatePassedToday('/tmp/x/speaks-2026-08-15.jsonl')).toBe(2);
    });

    it('ENOENT → 0（首日无历史）', async () => {
      const err = new Error('no such file') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      readFileMock.mockRejectedValue(err);
      expect(await countGatePassedToday('/tmp/x')).toBe(0);
    });
  });
});
