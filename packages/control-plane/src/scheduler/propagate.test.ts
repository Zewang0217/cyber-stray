/**
 * 无聊/精力时间前推测试（S5）
 *
 * 契约：pure function——给定宠物行 + 时刻，前推 boredom（随时间上升）与
 * energy（随时间恢复），夹取 0-100；null lastRunAt 回退 createdAt；
 * isReady = 无聊达阈值 且 精力够门槛。
 */

import { describe, it, expect } from 'vitest';
import {
  propagate,
  isReady,
  MINUTE_MS,
  DEFAULT_RATES,
  resolveRates,
  resolveWanderEffects,
  WANDER_BOREDOM_RELIEF,
  WANDER_ENERGY_COST,
  type PropagationRates,
} from './propagate.js';

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

describe('性格参数派生（#90）', () => {
  it('好奇 = 基准速率（存量宠物行为不回退：等于 DEFAULT_RATES）', () => {
    expect(resolveRates('curious')).toEqual(DEFAULT_RATES);
  });

  it('好奇无聊增速显著快于慵懒（acceptance：行为参数实测不同）', () => {
    const curious = resolveRates('curious').boredomPerMinute;
    const lazy = resolveRates('lazy').boredomPerMinute;
    expect(curious).toBeGreaterThan(lazy * 1.5);
  });

  it('慵懒精力恢复快于好奇（省电设定）', () => {
    expect(resolveRates('lazy').energyPerMinute).toBeGreaterThan(
      resolveRates('curious').energyPerMinute,
    );
  });

  it('resolveRates 可注入基准（测试加速场景）', () => {
    const base: PropagationRates = { boredomPerMinute: 1, energyPerMinute: 2 };
    const r = resolveRates('lazy', base);
    expect(r.boredomPerMinute).toBeCloseTo(0.6);
    expect(r.energyPerMinute).toBeCloseTo(2.3);
  });

  it('未知性格抛错（禁兜底）', () => {
    // @ts-expect-error 故意传非法 id 验证运行时守卫
    expect(() => resolveRates('grumpy')).toThrow(/grumpy/);
  });

  it('好奇游荡效果 = 基准常量（存量写回不回退）', () => {
    expect(resolveWanderEffects('curious')).toEqual({
      boredomRelief: WANDER_BOREDOM_RELIEF,
      energyCost: WANDER_ENERGY_COST,
    });
  });

  it('活泼游荡耗能更高（×1.15 → 35）；慵懒更省（×0.8 → 24）', () => {
    const playful = resolveWanderEffects('playful');
    const lazy = resolveWanderEffects('lazy');
    expect(playful.energyCost).toBe(Math.round(WANDER_ENERGY_COST * 1.15));
    expect(lazy.energyCost).toBe(Math.round(WANDER_ENERGY_COST * 0.8));
    expect(playful.energyCost).toBeGreaterThan(lazy.energyCost);
  });
});
