/**
 * 内置默认单价表（ADR-0007）—— 用量 × 单价 = 费用
 *
 * 单一真相源：聚合 API 在 CP 侧折算，agent 只记 raw 用量。
 * 单价为**内置默认**（调研确认火山/智谱无公开价格查询 API）；
 * 注册表在 shared/pricing；admin 切换模型前须先在注册表登记单价。
 *
 * 口径：DeepSeek 按 token 类型拆分计价（输入/输出价差 4 倍）；生图/质检按张。
 * 未知模型或缺失单价显式失败，预算闸不得将未知成本按零放行。
 */

import { requireModelPrice } from '@cyber-stray/shared/pricing';
import type { UsageRow } from '@cyber-stray/shared/usage';
export { DEFAULT_PRICES, requireModelPrice, type ModelPrice } from '@cyber-stray/shared/pricing';
export type { UsageRow } from '@cyber-stray/shared/usage';

/** 单条用量折算费用（¥）；未知成本抛错，由预算闸停止派发。 */
export function costOf(row: UsageRow): number {
  const price = requireModelPrice(row.model, row.kind);
  if (row.kind === 'llm') {
    const input = (row.inputTokens ?? 0) / 1_000_000 * (price.inputPerM ?? 0);
    const output = (row.outputTokens ?? 0) / 1_000_000 * (price.outputPerM ?? 0);
    // 旧行兼容：无 input/output 拆分 → 按 totalTokens 均价（输入价）粗估
    if (input === 0 && output === 0 && (row.tokens ?? 0) > 0) {
      return (row.tokens ?? 0) / 1_000_000 * (price.inputPerM ?? 0);
    }
    return input + output;
  }
  if (row.kind === 'image' || row.kind === 'vision_qc') {
    return (row.images ?? 0) * (price.perImage ?? 0);
  }
  return 0;
}
