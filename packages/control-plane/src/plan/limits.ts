/**
 * 套餐限额（S11，#78）
 *
 * 共享限额表的 CP 入口。存量套餐保留在 tenants.plan；实际权益先经
 * resolveEntitlements 解析，邀请内测统一使用 Pro，不启用收费。
 *
 * 原则（epic #67）：只卡"到达主人"的频率，不卡宠物自进化——游荡/学习/
 * 记忆永不付费墙，超限内容仍落盘（planLimited 标记），只是不推。
 */

/** 可保留的套餐值；实际可用权益由产品模式决定。 */
export const PLAN_VALUES = ['free', 'pro', 'byok'] as const;
import type { PlanLimits, PlanValue } from '@cyber-stray/shared/plan';
import { PLAN_LIMITS } from '@cyber-stray/shared/plan';
export type { PlanLimits, PlanValue } from '@cyber-stray/shared/plan';
export { PLAN_LIMITS } from '@cyber-stray/shared/plan';

/** 未知/缺失套餐回退 free（默认收最紧的权限，不放大） */
export function planLimits(plan: string | null | undefined): PlanLimits {
  return PLAN_LIMITS[(plan ?? 'free') as PlanValue] ?? PLAN_LIMITS.free;
}
