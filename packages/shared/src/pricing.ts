/** Shared model price registry and preflight guard. CP computes costs; every paid caller validates here. */
export interface ModelPrice {
  /** 输入价 ¥/M token */
  inputPerM?: number;
  /** 输出价 ¥/M token */
  outputPerM?: number;
  /** 每张价 ¥/张（生图/质检） */
  perImage?: number;
}

/**
 * 官方人民币价格，核验于 2026-10-06：
 * https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 * Flash 高峰：输入未命中 ¥2/M、缓存命中 ¥0.04/M、输出 ¥8/M；空闲均半价。
 * 账本未分缓存/峰谷，拆分用量统一按高峰未命中价估算预算上界，不冒充供应商账单。
 * 官方仍接受 deepseek-v4-flash，并由 DeepSeek-V4.1-Flash 服务，按 Flash 价计费。
 */
const DEEPSEEK_FLASH_BUDGET_PRICE: ModelPrice = { inputPerM: 2, outputPerM: 8 };

/** 内置成本估计表；增加模型时必须在此显式登记价格后才能调用。 */
export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  // DeepSeek 公开价：输入 ¥2/M、输出 ¥8/M（2026 在售）
  'deepseek-chat': { inputPerM: 2, outputPerM: 8 },
  'deepseek-v4-flash': DEEPSEEK_FLASH_BUDGET_PRICE,
  'deepseek-flash': DEEPSEEK_FLASH_BUDGET_PRICE,
  // Seedream 5.0 Lite：$0.055/张 ≈ ¥0.4/张（2K 档）
  'doubao-seedream-5-0-260128': { perImage: 0.4 },
  // 智谱 GLM-4V-Flash：免费
  'glm-4v-flash': { perImage: 0 },
  // ECNU 校内网关（ecnu-plus）：校内额度制、未见公开按张计价 → ¥0
  // （显式记录校内额度口径，不代表未知模型免费）
  'ecnu-plus': { perImage: 0 },
  // 智谱 GLM-4.5V（2025-08 上线价：输入 ¥2/M、输出 ¥6/M tokens）：
  // vision_qc 按次计（images=1/次），单次 ≈ 输入 1K + 输出 2K（思考模式
  // reasoning）≈ ¥0.014，取保守上界 ¥0.02/次——宁可高估不低估护栏成本
  'glm-4.5v': { perImage: 0.02 },
};

import type { UsageRow } from './usage.js';

/** Require configured pricing before dispatching or accounting for a model. */
export function requireModelPrice(model: string, kind: UsageRow['kind']): ModelPrice {
  const price = DEFAULT_PRICES[model];
  if (!price) throw new Error(`未知模型单价：${model}，请先配置价格`);
  const values = kind === 'llm' ? [price.inputPerM, price.outputPerM] : [price.perImage];
  if (values.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
    throw new Error(`模型 ${model} 缺少有效的 ${kind} 单价`);
  }
  return price;
}
