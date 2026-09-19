/**
 * 每租户每日 LLM 预算闸（#265，平台成本护栏）
 *
 * 产品红线：游荡/学习/记忆永不付费墙——本闸卡的是**平台**烧 DeepSeek key 的
 * 速度，不是用户付费墙。闸在调度侧（就绪判定后、派发前）收口：超限租户
 * 次轮停派发，租户侧语义「宠物在睡觉」，次日（日期键文件归零）自动恢复。
 *
 * 读取复用 usage.jsonl 当日累计 + 既有单价表（costOf），不新增存储、
 * 不另建并行索引。只计 kind=llm（生图/质检另有 petGenMonthlyQuota 月配额）。
 * 读失败向上抛错——闸的调用方（scheduler）fail-closed 停派，绝不把
 * 「判定不了」当「没花钱」。
 */

import { costOf } from '../pricing.js';
import { readTenantUsage } from '../usage.js';

/** 预算闸配置（SchedulerConfig.llmBudget） */
export interface LlmBudgetConfig {
  /** 总开关（false = 全部套餐不限） */
  enabled: boolean;
  /** 每日预算（¥/天，按套餐）；0 = 该套餐不限 */
  yuanPerPlan: { free: number; pro: number; byok: number };
}

/**
 * 套餐的每日预算上限（¥）；null = 不设闸（总开关关 / 该套餐 0 = 不限）。
 * 未知套餐按 free 收最紧（与 planLimits 同向）。
 */
export function planBudgetYuan(config: LlmBudgetConfig, plan: string): number | null {
  if (!config.enabled) return null;
  const key = plan === 'pro' || plan === 'byok' ? plan : 'free';
  const yuan = config.yuanPerPlan[key];
  return yuan > 0 ? yuan : null;
}

/** 租户今日 LLM 成本（¥）。读失败抛错（含日期键；ENOENT=空态返回 0） */
export async function todayLlmCostYuan(
  dataDir: string,
  tenantId: string,
  today: string,
): Promise<number> {
  const rows = await readTenantUsage(dataDir, tenantId, today, today);
  let cost = 0;
  for (const row of rows) {
    if (row.kind === 'llm') cost += costOf(row);
  }
  return cost;
}
