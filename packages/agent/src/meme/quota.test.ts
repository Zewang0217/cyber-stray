/**
 * 表情包配额测试（#96）
 *
 * - localDateKey：本地日期键
 * - countTodayMemes：只数当天 qcPass=true 的（失败/质检不过不占配额）
 * - memeQuotaRemaining：limit 0 = 不限；超限 = 0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { countTodayMemes, memeQuotaRemaining, localDateKey } from './quota.js';
import { memeManifestPath, memeAssetsDir } from './storage.js';

describe('表情包配额', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'meme-quota-'));
    mkdirSync(memeAssetsDir(dir), { recursive: true });
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('localDateKey 返回 YYYY-MM-DD', () => {
    expect(localDateKey(new Date(2026, 7, 20))).toBe('2026-08-20');
  });

  it('只数当天 qcPass=true 的（失败/质检不过不占配额）', async () => {
    writeFileSync(
      memeManifestPath(dir),
      JSON.stringify([
        { id: 'a', date: '2026-08-20', qcPass: true },
        { id: 'b', date: '2026-08-20', qcPass: false }, // 质检不过
        { id: 'c', date: '2026-08-19', qcPass: true }, // 昨天
      ]),
    );
    expect(await countTodayMemes(dir, '2026-08-20')).toBe(1);
  });

  it('limit 0 = 不限；超限 = 0', async () => {
    writeFileSync(
      memeManifestPath(dir),
      JSON.stringify([{ id: 'a', date: '2026-08-20', qcPass: true }]),
    );
    expect(await memeQuotaRemaining(dir, 0, '2026-08-20')).toBe(Number.POSITIVE_INFINITY);
    expect(await memeQuotaRemaining(dir, 1, '2026-08-20')).toBe(0);
    expect(await memeQuotaRemaining(dir, 3, '2026-08-20')).toBe(2);
  });
});
