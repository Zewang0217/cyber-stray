/**
 * 用量成本聚合（领域层，纯函数）
 *
 * 把 usage 明细行聚合为租户级 token/张数/成本/最近活跃——admin 用量可视化
 * 的计算核心。成本按内置默认单价表折算（pricing.ts），未知模型 0（不瞎估）。
 */

import { costOf, type UsageRow } from '../pricing.js';

export interface TenantUsageAgg {
  llmTokens: number;
  imageCount: number;
  visionCount: number;
  cost: number;
  lastActive: string | null;
}

/** 租户级用量聚合（单租户；无数据 = 0，不报错） */
export function aggregateTenantUsage(rows: UsageRow[]): TenantUsageAgg {
  let llmTokens = 0;
  let imageCount = 0;
  let visionCount = 0;
  let cost = 0;
  let lastActive: string | null = null;
  for (const row of rows) {
    if (row.kind === 'llm') {
      llmTokens += (row.inputTokens ?? 0) + (row.outputTokens ?? 0);
    } else if (row.kind === 'image') {
      imageCount += row.images ?? 1;
    } else if (row.kind === 'vision_qc') {
      visionCount += row.images ?? 1;
    }
    cost += costOf(row);
    if (!lastActive || row.timestamp > lastActive) lastActive = row.timestamp;
  }
  return { llmTokens, imageCount, visionCount, cost, lastActive };
}
