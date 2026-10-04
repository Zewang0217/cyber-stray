/**
 * 用量记录（ADR-0007，控制面侧）—— petgen 生图/质检 落租户 usage JSONL
 *
 * 与 agent 侧 usage/usage.ts 同构：租户目录 usage/usage-YYYY-MM-DD.jsonl，
 * 行 { timestamp, tenantId, kind, model, images? }；cost 由聚合 API 按单价表折算。
 * 付费调用必须等待记账；失败持久阻断后续调用，等待管理员核对。
 */

import { appendFile, mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tenantDataDir } from './tenant.js';
import { UsageEntrySchema, type UsageEntryInput } from '@cyber-stray/shared/usage';
import type { UsageRow } from '../domain/pricing.js';

export type UsageKind = UsageRow['kind'];
export type UsageEntry = UsageRow;
const ACCOUNTING_BLOCK_FILE = 'usage-accounting-block.json';
const blockedTenants = new Set<string>();

/** Accounting failures require operator reconciliation, never automatic spending retries. */
export class UsageAccountingError extends Error {}

/** Persist a tenant-wide latch outside the usage directory, so a broken ledger cannot hide it. */
export async function markUsageAccountingFailure(tenantDir: string, cause: unknown): Promise<void> {
  blockedTenants.add(tenantDir);
  await writeFile(join(tenantDir, ACCOUNTING_BLOCK_FILE), JSON.stringify({
    at: new Date().toISOString(), reason: cause instanceof Error ? cause.message : String(cause),
  }), { mode: 0o600 });
}

/** Check even when the daily budget is disabled: missing accounting is not an unlimited budget. */
export async function assertUsageHealthy(tenantDir: string): Promise<void> {
  if (blockedTenants.has(tenantDir)) throw new UsageAccountingError('用量记账失败，已暂停付费调用，需管理员核对账本');
  try { await readFile(join(tenantDir, ACCOUNTING_BLOCK_FILE), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new UsageAccountingError('用量账本有未处理的记账故障，需管理员核对后恢复');
}

/** 本地日期键（YYYY-MM-DD；与 agent 侧 speaks/usage 文件同源） */
export function localDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Record measured usage durably; failed accounting blocks subsequent billable operations. */
export async function recordUsage(
  tenantDir: string,
  entry: UsageEntryInput,
): Promise<void> {
  await assertUsageHealthy(tenantDir);
  try {
    const line = UsageEntrySchema.parse({ timestamp: new Date().toISOString(), ...entry });
    const dir = join(tenantDir, 'usage');
    await mkdir(dir, { recursive: true });
    const file = join(dir, `usage-${localDateKey()}.jsonl`);
    await appendFile(file, JSON.stringify(line) + '\n', 'utf-8');
  } catch (cause) {
    try { await markUsageAccountingFailure(tenantDir, cause); }
    catch (markerError) {
      throw new UsageAccountingError('记账与故障标记均写入失败，付费调用已暂停', { cause: new AggregateError([cause, markerError]) });
    }
    throw new UsageAccountingError('用量记账失败，付费调用已暂停', { cause });
  }
}

/** petgen 用量记录器：模型由实际发请求的 provider 传入，不再读取热更新配置。 */
export interface PetUsageRecorder {
  /** 生图 HTTP 成功后、解析响应或写图片前调用 */
  recordImage(tenantId: string, model: string): Promise<void>;
  /** 视觉质检 HTTP 成功后、解析响应前调用 */
  recordVision(tenantId: string, model: string): Promise<void>;
}

/** usage 文件名日期（usage-YYYY-MM-DD.jsonl → 'YYYY-MM-DD'）；非法名 = null */
export function usageFileDate(file: string): string | null {
  const m = /^usage-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(file);
  return m ? m[1]! : null;
}

/**
 * 读租户 usage 行（时间范围 [from, to] 日期字符串，本地日期键；缺省全部）。
 * 目录不存在 = 合法空态（租户未产生用量）返回 []；半行与非法计量显式报错；
 * 其余读失败抛错——调用方（预算闸）不得把「读不到」当「没花钱」。
 *
 * 日期归属以文件名为准（写入口径 localDateKey，文件即天分区）：行内
 * timestamp 是 UTC，东八区 00:00-08:00 的行 UTC 日期还是前一天——若按行内
 * UTC 日期再筛会两边都算不到（本地日文件里被 from/to 排除，前一日的文件
 * 里又没有它），故不做行级日期过滤。
 */
export async function readTenantUsage(
  dataDir: string,
  tenantId: string,
  from?: string,
  to?: string,
): Promise<UsageRow[]> {
  await assertUsageHealthy(tenantDataDir(dataDir, tenantId));
  const dir = join(tenantDataDir(dataDir, tenantId), 'usage');
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; // 租户未产生用量 = 合法空态
    await markUsageAccountingFailure(tenantDataDir(dataDir, tenantId), error);
    throw error;
  }
  const rows: UsageRow[] = [];
  for (const file of files) {
    const date = usageFileDate(file);
    if (!date) continue;
    if (from && date < from) continue;
    if (to && date > to) continue;
    let content: string;
    try {
      content = await readFile(join(dir, file), 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; // 并发轮转可能消失
      await markUsageAccountingFailure(tenantDataDir(dataDir, tenantId), error);
      throw error;
    }
    for (const [index, line] of content.split('\n').entries()) {
      if (!line.trim()) continue;
      let row: UsageRow;
      try {
        row = UsageEntrySchema.parse(JSON.parse(line));
        if (row.tenantId !== tenantId) throw new Error('租户不匹配');
      } catch (cause) {
        await markUsageAccountingFailure(tenantDataDir(dataDir, tenantId), cause);
        throw new Error(`用量账本 ${file}:${index + 1} 损坏或计量字段无效`, { cause });
      }
      rows.push(row);
    }
  }
  return rows;
}

/** 创建 petgen 用量记录器（dataDir 为 CP 全局数据目录，含 tenants/<sub>） */
export function createPetUsageRecorder(
  dataDir: string,
): PetUsageRecorder {
  return {
    recordImage(tenantId: string, model: string) {
      return recordUsage(tenantDataDir(dataDir, tenantId), {
        tenantId,
        kind: 'image',
        model,
        images: 1,
      });
    },
    recordVision(tenantId: string, model: string) {
      return recordUsage(tenantDataDir(dataDir, tenantId), {
        tenantId,
        kind: 'vision_qc',
        model,
        images: 1,
      });
    },
  };
}
