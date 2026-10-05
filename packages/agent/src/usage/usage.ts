/**
 * 用量记录（ADR-0007）—— LLM token / 生图张数 / 质检张数 落租户 usage JSONL
 *
 * 文件：<dataDir>/usage/usage-YYYY-MM-DD.jsonl（本地日期轮转，与 speaks 同源；
 * 租户目录隔离天然成立，备份天然包含）。
 * 行：{ timestamp, tenantId, kind, model, tokens?, images? }——cost 不在行内，
 * 由控制面聚合时按单价表折算（单价表单一真相源在 shared/pricing）。
 *
 * 账本用于平台预算，记录失败必须停下；worker 以专用退出码要求 CP 停派发。
 */

import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { getTenantId } from '../config.js';
import type { ImageGenerator } from '../meme/types.js';
import { UsageEntrySchema, type UsageRow } from '@cyber-stray/shared/usage';
import { requireModelPrice } from '@cyber-stray/shared/pricing';

/** 用量类型：llm 调用 / 生图 / 视觉质检 */
export type UsageKind = 'llm' | 'image' | 'vision_qc';

/** 用量已发生但账本无法写入，不能按普通 provider 错误重试。 */
export class UsageAccountingError extends Error {
  constructor(cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`用量记账失败，停止后续派发并检查账本：${detail}`, { cause });
    this.name = 'UsageAccountingError';
  }
}

const accountingFailures = new Map<string, UsageAccountingError>();

/** 工具/可选管线可能捕获错误；worker 返回前仍须检查账本健康，避免虚报成功。 */
export function assertUsageHealthy(dataDir: string): void {
  const failure = accountingFailures.get(dataDir);
  if (failure) throw failure;
}

/** 付费调用前验证账本及实际模型的单价，未知价格不能先花费再发现。 */
export function assertUsageReady(dataDir: string, model: string, kind: UsageKind): void {
  assertUsageHealthy(dataDir);
  requireModelPrice(model, kind);
}

export type UsageEntry = UsageRow;

/** HTTP 成功响应已发生计费，在解析内容或落图之前调用且等待此回调。 */
export interface UsageTrackedRequest {
  onUsage?: () => Promise<void>;
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
 * 记录一条用量；写入失败明确抛错并锁住本 worker 的账本。
 */
export async function recordUsage(
  dataDir: string,
  entry: Omit<UsageEntry, 'timestamp' | 'tenantId'>,
): Promise<void> {
  assertUsageHealthy(dataDir);
  try {
    const dir = join(dataDir, 'usage');
    await mkdir(dir, { recursive: true });
    const file = join(dir, `usage-${localDateKey()}.jsonl`);
    const line = UsageEntrySchema.parse({
      timestamp: new Date().toISOString(),
      tenantId: currentTenantId(),
      ...entry,
    });
    await appendFile(file, JSON.stringify(line) + '\n', 'utf-8');
  } catch (error) {
    const failure = new UsageAccountingError(error);
    accountingFailures.set(dataDir, failure);
    throw failure;
  }
}

/** 在供应商确认付费响应时记账；本地解析/落盘失败不会抹掉已发生的费用。 */
async function trackProviderResponse<T>(
  dataDir: string, model: string, kind: 'image' | 'vision_qc',
  call: (onUsage: () => Promise<void>) => Promise<T>,
): Promise<T> {
  assertUsageReady(dataDir, model, kind);
  let acknowledged = false;
  const result = await call(async () => {
    if (acknowledged) throw new Error('供应商重复报告同一次付费响应');
    acknowledged = true;
    await recordUsage(dataDir, { kind, model, images: 1 });
  });
  if (!acknowledged) {
    const failure = new UsageAccountingError('供应商返回成功却没有报告付费响应');
    accountingFailures.set(dataDir, failure);
    throw failure;
  }
  return result;
}

/** 生图用量包装：计量回调在 HTTP 成功后、图片解析/落盘前执行。 */
export function withImageUsageTracking(
  gen: ImageGenerator,
  dataDir: string,
  model: string,
): ImageGenerator {
  return {
    async generate(req) {
      return trackProviderResponse(dataDir, model, 'image', (onUsage) => gen.generate({ ...req, onUsage }));
    },
  };
}

/** 视觉质检计量在 HTTP 成功后执行，无效生成内容同样计量。 */
export function withVisionUsageTracking<Request extends UsageTrackedRequest, Result>(
  fn: (req: Request) => Promise<Result>,
  dataDir: string,
  model: string,
): (req: Request) => Promise<Result> {
  return (req) => trackProviderResponse(dataDir, model, 'vision_qc', (onUsage) => fn({ ...req, onUsage }));
}

/** 从 AI SDK 模型实例取模型 ID（provider.chat('deepseek-chat') → 'deepseek-chat'）；拿不到 → 'unknown' */
export function modelIdOf(model: unknown): string {
  if (model && typeof model === 'object') {
    const id = (model as { modelId?: unknown }).modelId;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return 'unknown';
}
