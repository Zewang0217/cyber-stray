import type { EffectiveEntitlements, PlanValue, ProductMode } from '@cyber-stray/shared/plan';
import { PLAN_LIMITS, PLAN_VALUES } from './limits.js';

/** Resolve all runtime benefits in one place without rewriting stored billing tiers. */
export function resolveEntitlements(
  storedPlan: string | null | undefined,
  mode: ProductMode = 'invite_beta',
): EffectiveEntitlements {
  const plan = mode === 'invite_beta' ? 'pro' : parseStoredPlan(storedPlan);
  return { mode, plan, limits: PLAN_LIMITS[plan], billing: { enabled: false, canPurchase: false } };
}

function parseStoredPlan(value: string | null | undefined): PlanValue {
  if (!PLAN_VALUES.includes(value as PlanValue)) throw new Error(`无效的租户权益：${String(value)}`);
  return value as PlanValue;
}

/** Paid mode is reserved until an actual checkout and payment verification provider is installed. */
export function parseProductMode(value: string = 'invite_beta'): ProductMode {
  if (value === 'invite_beta') return value;
  if (value === 'paid') throw new Error('CP_PRODUCT_MODE=paid 尚无支付服务实现，禁止启用收费模式');
  throw new Error(`无效的 CP_PRODUCT_MODE：${value}`);
}
