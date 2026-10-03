/**
 * X1 信念判定测试（#302 验收）——成立/不成立/窗口边界（D7、D14、D15）
 *
 * 验收原文：判定脚本三组 fake 数据测试（成立/不成立/窗口边界）。
 */

import { describe, expect, it } from 'vitest';
import { addDays, computeX1 } from './x1.js';

describe('addDays', () => {
  it('跨月进位', () => {
    expect(addDays('2026-09-25', 7)).toBe('2026-10-02');
    expect(addDays('2026-12-30', 7)).toBe('2027-01-06');
  });

  it('非法日期键抛错（禁兜底）', () => {
    expect(() => addDays('2026/09/01', 1)).toThrow();
  });
});

describe('computeX1', () => {
  // D0 = 2026-09-01 → 前向窗 [2026-09-08, 2026-09-15]
  const base = { adoptedDay: '2026-09-01', feedbackCount: 1 };

  it('成立：窗内回访 + 有反馈', () => {
    const r = computeX1({ ...base, activityDays: ['2026-09-03', '2026-09-10'] });
    expect(r.x1).toBe(true);
    expect(r.windowStart).toBe('2026-09-08');
    expect(r.windowEnd).toBe('2026-09-15');
    expect(r.revisitDaysInWindow).toEqual(['2026-09-10']);
  });

  it('不成立：只有窗外（D7 之前）回访', () => {
    const r = computeX1({ ...base, activityDays: ['2026-09-03', '2026-09-05'] });
    expect(r.x1).toBe(false);
    expect(r.revisitDaysInWindow).toEqual([]);
  });

  it('边界：D7 当天（窗首）算回访', () => {
    const r = computeX1({ ...base, activityDays: ['2026-09-08'] });
    expect(r.x1).toBe(true);
  });

  it('边界：D14 当天（窗尾）算回访', () => {
    const r = computeX1({ ...base, activityDays: ['2026-09-15'] });
    expect(r.x1).toBe(true);
  });

  it('边界：D15（窗外一天）不算', () => {
    const r = computeX1({ ...base, activityDays: ['2026-09-16'] });
    expect(r.x1).toBe(false);
  });

  it('不成立：窗内回访但零反馈（「为我进化」无证据）', () => {
    const r = computeX1({ adoptedDay: '2026-09-01', activityDays: ['2026-09-10'], feedbackCount: 0 });
    expect(r.x1).toBe(false);
  });

  it('不成立：从未回访', () => {
    const r = computeX1({ ...base, activityDays: [] });
    expect(r.x1).toBe(false);
  });
});
