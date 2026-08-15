/**
 * 无聊/精力时间前推测试（S5）
 *
 * 契约：pure function——给定宠物行 + 时刻，前推 boredom（随时间上升）与
 * energy（随时间恢复），夹取 0-100；null lastRunAt 回退 createdAt；
 * isReady = 无聊达阈值 且 精力够门槛。
 */

import { describe, it, expect } from 'vitest';
import { propagate, isReady, MINUTE_MS, type PropagationRates } from './propagate.js';

const rates: PropagationRates = {
  boredomPerMinute: 1, // 测试加速：1 分钟 +1
  energyPerMinute: 2, // 1 分钟 +2
};

const base = {
  id: 'p1',
  tenantId: 't1',
  name: 'cat',
  status: 'active' as const,
  plan: 'free' as const,
  createdAt: 0,
  updatedAt: 0,
};

describe('时间前推', () => {
  it('boredom 随时间上升、energy 恢复', () => {
    const p = propagate(
      { ...base, lastRunAt: 0, boredom: 30, energy: 50 },
      10 * MINUTE_MS,
      rates,
    );
    expect(p.boredom).toBe(40); // 30 + 10*1
    expect(p.energy).toBe(70); // 50 + 10*2
  });

  it('夹取 0-100', () => {
    const p = propagate(
      { ...base, lastRunAt: 0, boredom: 99, energy: 99 },
      100 * MINUTE_MS,
      rates,
    );
    expect(p.boredom).toBe(100);
    expect(p.energy).toBe(100);
  });

  it('elapsed = 0 时原样返回', () => {
    const p = propagate({ ...base, lastRunAt: 5_000, boredom: 30, energy: 80 }, 5_000, rates);
    expect(p.boredom).toBe(30);
    expect(p.energy).toBe(80);
  });

  it('null lastRunAt 回退 createdAt', () => {
    const p = propagate({ ...base, lastRunAt: null, boredom: 30, energy: 80 }, 5 * MINUTE_MS, {
      ...rates,
      // createdAt = 0，elapsed 5min
    });
    // 传入 pet 无 createdAt 字段时测试对象需带：见下个用例（此处 base.createdAt=0）
    expect(p.boredom).toBe(30 + 5);
    expect(p.energy).toBe(80 + 10);
  });

  it('isReady：无聊 ≥ 70 且 精力 ≥ 40', () => {
    expect(isReady({ boredom: 70, energy: 40 })).toBe(true);
    expect(isReady({ boredom: 69, energy: 40 })).toBe(false);
    expect(isReady({ boredom: 70, energy: 39 })).toBe(false);
    expect(isReady({ boredom: 100, energy: 100 })).toBe(true);
  });
});
