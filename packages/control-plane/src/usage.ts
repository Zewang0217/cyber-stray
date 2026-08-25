/**
 * 用量记录（ADR-0007，控制面侧）—— petgen 生图/质检 落租户 usage JSONL
 *
 * 与 agent 侧 usage/usage.ts 同构：租户目录 usage/usage-YYYY-MM-DD.jsonl，
 * 行 { timestamp, tenantId, kind, model, images? }；cost 由聚合 API 按单价表折算。
 * no-throw：生图/质检是可选功能，用量记录失败绝不影响管线。
 */

import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tenantDataDir } from './tenant.js';
import { logger } from './logger.js';

export type UsageKind = 'llm' | 'image' | 'vision_qc';

export interface UsageEntry {
  timestamp: string;
  /** 租户键（Casdoor sub） */
  tenantId: string;
  kind: UsageKind;
  model: string;
  tokens?: number;
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
