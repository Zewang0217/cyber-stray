/**
 * 用量记录（ADR-0007，控制面侧）—— petgen 生图/质检 落租户 usage JSONL
 *
 * 与 agent 侧 usage/usage.ts 同构：租户目录 usage/usage-YYYY-MM-DD.jsonl，
 * 行 { timestamp, tenantId, kind, model, images? }；cost 由聚合 API 按单价表折算。
 * no-throw：生图/质检是可选功能，用量记录失败绝不影响管线。
 */

import { appendFile, mkdir, readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { tenantDataDir } from './tenant.js';
import { logger } from './logger.js';
import type { UsageRow } from '../domain/pricing.js';

export type UsageKind = 'llm' | 'image' | 'vision_qc';

export interface UsageEntry {
  timestamp: string;
  /** 租户键（Casdoor sub） */
  tenantId: string;
  kind: UsageKind;
  model: string;
  tokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  images?: number;
}

/** 本地日期键（YYYY-MM-DD；与 agent 侧 speaks/usage 文件同源） */
export function localDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 记录一条用量到租户 usage 文件（no-throw） */
export async function recordUsage(
  tenantDir: string,
  entry: Omit<UsageEntry, 'timestamp'>,
): Promise<void> {
  try {
    const dir = join(tenantDir, 'usage');
    await mkdir(dir, { recursive: true });
    const file = join(dir, `usage-${localDateKey()}.jsonl`);
    const line: UsageEntry = { timestamp: new Date().toISOString(), ...entry };
    await appendFile(file, JSON.stringify(line) + '\n', 'utf-8');
  } catch (error) {
    logger.warn('记录用量失败（不影响主流程）', { error });
  }
}

/** petgen 用量记录器（模型名闭包绑定；processor 调用时只需租户 id） */
export interface PetUsageRecorder {
  /** 生图成功（概念图或网格批次）后调用 */
  recordImage(tenantId: string): void;
  /** 视觉质检成功后调用 */
  recordVision(tenantId: string): void;
}

/** usage 文件名日期（usage-YYYY-MM-DD.jsonl → 'YYYY-MM-DD'）；非法名 = null */
export function usageFileDate(file: string): string | null {
  const m = /^usage-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(file);
  return m ? m[1]! : null;
}

/**
 * 读租户 usage 行（时间范围 [from, to] 日期字符串；缺省全部；行内 timestamp 再筛）。
 * 目录不存在 = 合法空态（租户未产生用量）返回 []；半行写入（崩溃残留）跳过；
 * 其余读失败抛错——调用方（预算闸）不得把「读不到」当「没花钱」。
 */
export async function readTenantUsage(
  dataDir: string,
  tenantId: string,
  from?: string,
  to?: string,
): Promise<UsageRow[]> {
  const dir = join(tenantDataDir(dataDir, tenantId), 'usage');
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; // 租户未产生用量 = 合法空态
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
      throw error;
    }
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let row: UsageRow;
      try {
        row = JSON.parse(line) as UsageRow;
      } catch {
        continue; // 半行写入（崩溃残留）跳过，不拖垮聚合
      }
      if (!row.timestamp || typeof row.kind !== 'string') continue;
      const day = row.timestamp.slice(0, 10);
      if (from && day < from) continue;
      if (to && day > to) continue;
      rows.push(row);
    }
  }
  return rows;
}

/** 创建 petgen 用量记录器（dataDir 为 CP 全局数据目录，含 tenants/<sub>） */
export function createPetUsageRecorder(
  dataDir: string,
  models: { imageModel: string; visionModel: string },
): PetUsageRecorder {
  return {
    recordImage(tenantId: string) {
      void recordUsage(tenantDataDir(dataDir, tenantId), {
        tenantId,
        kind: 'image',
        model: models.imageModel,
        images: 1,
      });
    },
    recordVision(tenantId: string) {
      void recordUsage(tenantDataDir(dataDir, tenantId), {
        tenantId,
        kind: 'vision_qc',
        model: models.visionModel,
        images: 1,
      });
    },
  };
}
