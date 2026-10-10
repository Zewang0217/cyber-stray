import { z } from 'zod';

const count = z.number().int().nonnegative().finite();
const entry = z.object({
  tenantId: z.string().min(1),
  kind: z.enum(['llm', 'image', 'vision_qc']),
  model: z.string().min(1),
  tokens: count.optional(),
  inputTokens: count.optional(),
  outputTokens: count.optional(),
  /** 输入中缓存命中部分（DeepSeek prompt_cache_hit_tokens）；未命中 = inputTokens − 此值。旧行无此字段。 */
  inputCacheHitTokens: count.optional(),
  images: count.optional(),
});

function hasConsistentMeasurement(value: z.infer<typeof entry>): boolean {
  if (value.kind !== 'llm') return value.images !== undefined;
  const { tokens, inputTokens, outputTokens, inputCacheHitTokens } = value;
  // 历史记录可能只有 total；一旦出现拆分就必须完整，不能把缺失一侧按零计价。
  if (inputTokens === undefined && outputTokens === undefined) return tokens !== undefined;
  if (inputTokens === undefined || outputTokens === undefined) return false;
  // 命中拆分是输入的子集，超出 = 计量自相矛盾，须拒绝入账。
  if (inputCacheHitTokens !== undefined && inputCacheHitTokens > inputTokens) return false;
  return tokens === undefined || tokens === inputTokens + outputTokens;
}

/** Raw usage must carry measured quantities; missing usage is an accounting error. */
const MEASUREMENT_ERROR = '用量计量字段不完整或总量与拆分不一致';
export const UsageEntryInputSchema = entry.refine(hasConsistentMeasurement, MEASUREMENT_ERROR);
export const UsageEntrySchema = entry.extend({ timestamp: z.string().datetime({ offset: true }) })
  .refine(hasConsistentMeasurement, MEASUREMENT_ERROR);
export type UsageRow = z.infer<typeof UsageEntrySchema>;
export type UsageEntryInput = z.infer<typeof UsageEntryInputSchema>;
