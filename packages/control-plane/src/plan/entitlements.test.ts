import { describe, expect, it } from 'vitest';
import { parseProductMode, resolveEntitlements } from './entitlements.js';

describe('effective entitlements', () => {
  it('grants the original Pro benefits to existing free and BYOK invite beta tenants', () => {
    for (const storedPlan of ['free', 'pro', 'byok']) {
      expect(resolveEntitlements(storedPlan)).toEqual({
        mode: 'invite_beta', plan: 'pro',
        limits: { pushesPerDay: 20, boostIntervalMs: 86_400_000 },
        billing: { enabled: false, canPurchase: false },
      });
    }
  });
  it('reserves explicit paid tiers but prevents startup without a payment provider implementation', () => {
    expect(resolveEntitlements('free', 'paid').plan).toBe('free');
    expect(parseProductMode()).toBe('invite_beta');
    expect(() => parseProductMode('paid')).toThrow('支付服务');
    expect(() => parseProductMode('invalid')).toThrow('CP_PRODUCT_MODE');
    expect(() => resolveEntitlements('invalid', 'paid')).toThrow('租户权益');
  });
});
