import { describe, it, expect } from 'vitest';
import { PLAN_LIMITS, planLimits, PLAN_VALUES, type PlanValue } from './limits.js';

describe('plan limits（S11 套餐限额）', () => {
  it('三套餐齐全：free/pro/byok', () => {
    expect([...PLAN_VALUES].sort()).toEqual(['byok', 'free', 'pro']);
  });

  it('推送频率：free ≤ pro；byok 同 pro（自带 key 平台无成本）', () => {
    expect(PLAN_LIMITS.free!.pushesPerDay).toBeLessThanOrEqual(5);
    expect(PLAN_LIMITS.pro!.pushesPerDay).toBe(20);
    expect(PLAN_LIMITS.byok!.pushesPerDay).toBe(PLAN_LIMITS.pro!.pushesPerDay);
  });

  it('操控（顶话题）节流：free 30 天、pro/byok 1 天', () => {
    expect(PLAN_LIMITS.free!.boostIntervalMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(PLAN_LIMITS.pro!.boostIntervalMs).toBe(24 * 60 * 60 * 1000);
    expect(PLAN_LIMITS.byok!.boostIntervalMs).toBe(PLAN_LIMITS.pro!.boostIntervalMs);
  });

  it('planLimits：未知/undefined 套餐回退 free（不放大权限）', () => {
    expect(planLimits(undefined)).toBe(PLAN_LIMITS.free);
    expect(planLimits('enterprise' as PlanValue)).toBe(PLAN_LIMITS.free);
  });
});
