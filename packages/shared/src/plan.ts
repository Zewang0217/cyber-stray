/** Product mode and effective benefits consumed by CP and its clients. */
export type ProductMode = 'invite_beta' | 'paid';
export type PlanValue = 'free' | 'pro' | 'byok';

export interface PlanLimits {
  pushesPerDay: number;
  boostIntervalMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const PLAN_LIMITS: Record<PlanValue, PlanLimits> = {
  free: { pushesPerDay: 5, boostIntervalMs: 30 * DAY_MS },
  pro: { pushesPerDay: 20, boostIntervalMs: DAY_MS },
  byok: { pushesPerDay: 20, boostIntervalMs: DAY_MS },
};
export const INVITE_BETA_LIMITS: PlanLimits = PLAN_LIMITS.pro;

export interface EffectiveEntitlements {
  mode: ProductMode;
  plan: PlanValue;
  limits: PlanLimits;
  billing: { enabled: boolean; canPurchase: boolean };
}

/** Current account benefits. Stored future billing tiers are not a user-facing purchase. */
export interface PlanState extends EffectiveEntitlements {
  pushWindow: { startHour: number; endHour: number } | null;
  byok: { keyBound: boolean };
}

/** Validate the API view once at the consumer boundary. */
export function isPlanState(value: unknown): value is PlanState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<PlanState>;
  if (v.mode !== 'invite_beta' && v.mode !== 'paid') return false;
  if (v.plan !== 'free' && v.plan !== 'pro' && v.plan !== 'byok') return false;
  if (!v.limits || !Number.isInteger(v.limits.pushesPerDay) || v.limits.pushesPerDay < 0 ||
      !Number.isInteger(v.limits.boostIntervalMs) || v.limits.boostIntervalMs < 0) return false;
  if (!v.billing || typeof v.billing.enabled !== 'boolean' || typeof v.billing.canPurchase !== 'boolean') return false;
  if (!v.byok || typeof v.byok.keyBound !== 'boolean') return false;
  return v.pushWindow === null || (typeof v.pushWindow === 'object' &&
    Number.isInteger(v.pushWindow?.startHour) && Number.isInteger(v.pushWindow?.endHour) &&
    v.pushWindow.startHour >= 0 && v.pushWindow.startHour <= 23 &&
    v.pushWindow.endHour >= 0 && v.pushWindow.endHour <= 23 && v.pushWindow.startHour !== v.pushWindow.endHour);
}
