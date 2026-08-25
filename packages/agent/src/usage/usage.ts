/**
 * 用量记录（ADR-0007）—— LLM token / 生图张数 / 质检张数 落租户 usage JSONL
 *
 * 文件：<dataDir>/usage/usage-YYYY-MM-DD.jsonl（本地日期轮转，与 speaks 同源；
 * 租户目录隔离天然成立，备份天然包含）。
 * 行：{ timestamp, tenantId, kind, model, tokens?, images? }——cost 不在行内，
 * 由控制面聚合时按单价表折算（单价表单一真相源在 CP）。
 *
 * 铁律：no-throw。埋点在 LLM/生图主路径上，记录失败绝不影响主流程
 * （speak.ts 同模式：catch + warn）。
 */

import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { getTenantId } from '../config.js';
import { logger } from '../logger.js';
import type { ImageGenerator } from '../meme/types.js';

/** 用量类型：llm 调用 / 生图 / 视觉质检 */
export type UsageKind = 'llm' | 'image' | 'vision_qc';

export interface UsageEntry {
  /** ISO 时间戳 */
  timestamp: string;
  /** 租户键（Casdoor sub / 注册 id）；单用户模式 = 'default' */
  tenantId: string;
  kind: UsageKind;
  /** 模型 ID（如 deepseek-chat / doubao-seedream-5-0-260128 / glm-4v-flash） */
  model: string;
  /** LLM 调用总 token（兼容旧行；新行用 inputTokens/outputTokens） */
  tokens?: number;
  /** LLM 输入 token */
  inputTokens?: number;
  /** LLM 输出 token */
  outputTokens?: number;
  /** 生图/质检张数（每次调用 1 张） */
  images?: number;
}

/** 本地日期键（YYYY-MM-DD；与 speaks-*.jsonl 文件名同源，见 push-budget.localDateKey） */
export function localDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 当前租户 ID（tenant context；单用户模式 null → 'default'） */
export function currentTenantId(): string {
  return getTenantId() ?? 'default';
}

/**
 * 记录一条用量（no-throw：文件写失败只 warn，不打断主流程）
 */
export async function recordUsage(
  dataDir: string,
  entry: Omit<UsageEntry, 'timestamp' | 'tenantId'>,
): Promise<void> {
  try {
    const dir = join(dataDir, 'usage');
    await mkdir(dir, { recursive: true });
    const file = join(dir, `usage-${localDateKey()}.jsonl`);
    const line: UsageEntry = {
      timestamp: new Date().toISOString(),
      tenantId: currentTenantId(),
      ...entry,
    };
    await appendFile(file, JSON.stringify(line) + '\n', 'utf-8');
  } catch (error) {
    logger.warn('记录用量失败（不影响主流程）', { error });
  }
}

/** 生图用量包装：generate 成功后记一条 image 用量（模型名绑定，装饰器） */
export function withImageUsageTracking(
  gen: ImageGenerator,
  dataDir: string,
  model: string,
): ImageGenerator {
  return {
    async generate(req) {
      const result = await gen.generate(req);
      await recordUsage(dataDir, { kind: 'image', model, images: 1 });
      return result;
    },
  };
}

/** 视觉质检用量包装：inspect 成功后记一条 vision_qc 用量 */
export function withVisionUsageTracking<F extends (req: never) => Promise<unknown>>(
  fn: F,
  dataDir: string,
  model: string,
): F {
  return (async (req: never) => {
    const result = await fn(req);
    await recordUsage(dataDir, { kind: 'vision_qc', model, images: 1 });
    return result;
  }) as F;
}

/** 从 AI SDK 模型实例取模型 ID（provider.chat('deepseek-chat') → 'deepseek-chat'）；拿不到 → 'unknown' */
export function modelIdOf(model: unknown): string {
  if (model && typeof model === 'object') {
    const id = (model as { modelId?: unknown }).modelId;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return 'unknown';
}
