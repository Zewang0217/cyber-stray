/**
 * 套餐限额（S11，#78）
 *
 * Plan 门控的唯一策略源：推送频率、操控（顶话题）节流。billing 表只在
 * Stripe 接入后启用（不建自建计量），当前 plan 存 pets.plan。
 *
 * 原则（epic #67）：只卡"到达主人"的频率，不卡宠物自进化——游荡/学习/
 * 记忆永不付费墙，超限内容仍落盘（planLimited 标记），只是不推。
 */

/** 套餐值（与 pets.plan enum 同步） */
export const PLAN_VALUES = ['free', 'pro', 'byok'] as const;
export type PlanValue = (typeof PLAN_VALUES)[number];

export interface PlanLimits {
  /** 每日推送上限（gate 放行的 speak 落盘数；超限标 planLimited 不推） */
  pushesPerDay: number;
  /** 顶话题最小间隔（ms；S9 节流，S11 收编统一策略源） */
  boostIntervalMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const PLAN_LIMITS: Record<PlanValue, PlanLimits> = {
  free: { pushesPerDay: 5, boostIntervalMs: 30 * DAY_MS },
  pro: { pushesPerDay: 20, boostIntervalMs: DAY_MS },
  // BYOK 重用户自带 key：平台不烧 token，限额对齐 Pro
  byok: { pushesPerDay: 20, boostIntervalMs: DAY_MS },
};

/** 未知/缺失套餐回退 free（默认收最紧的权限，不放大） */
export function planLimits(plan: string | null | undefined): PlanLimits {
  return PLAN_LIMITS[(plan ?? 'free') as PlanValue] ?? PLAN_LIMITS.free;
}
