/**
 * 内置默认单价表（ADR-0007）—— 用量 × 单价 = 费用
 *
 * 单一真相源：聚合 API 在 CP 侧折算，agent 只记 raw 用量。
 * 单价为**内置默认**（调研确认火山/智谱无公开价格查询 API）；
 * 覆盖路径：admin 面板改配置（#131 配置表落地后接同一处）。
 *
 * 口径：DeepSeek 按 token 类型拆分计价（输入/输出价差 4 倍）；生图/质检按张。
 * 未知模型兜底 ¥0（不瞎估，宁缺勿错）。
 */

export interface ModelPrice {
  /** 输入价 ¥/M token */
  inputPerM?: number;
  /** 输出价 ¥/M token */
  outputPerM?: number;
  /** 每张价 ¥/张（生图/质检） */
  perImage?: number;
}

/** 内置默认单价（2026-08 公开价；可被配置覆盖） */
export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  // DeepSeek 公开价：输入 ¥2/M、输出 ¥8/M（2026 在售）
  'deepseek-chat': { inputPerM: 2, outputPerM: 8 },
  // Seedream 5.0 Lite：$0.055/张 ≈ ¥0.4/张（2K 档）
  'doubao-seedream-5-0-260128': { perImage: 0.4 },
  // 智谱 GLM-4V-Flash：免费
  'glm-4v-flash': { perImage: 0 },
};

export interface UsageRow {
  timestamp: string;
  tenantId: string;
  kind: 'llm' | 'image' | 'vision_qc';
  model: string;
  tokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  images?: number;
}

/** 单条用量折算费用（¥；未知模型/未知 kind = 0，不瞎估） */
export function costOf(row: UsageRow): number {
  const price = DEFAULT_PRICES[row.model];
  if (!price) return 0;
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
