/**
 * 租户活跃日志（#272 X1 信念指标的「回访」信号）
 *
 * requireTenant 门后每个鉴权请求追加一行：tenants/<id>/activity/activity-YYYY-MM-DD.jsonl，
 * 行 { timestamp, tenantId, kind }。每请求一行（内测 3-5 租户无压力），离线聚合时
 * 去重出「活跃日」。no-throw：度量失败绝不影响业务请求（同 recordUsage 立场）。
 *
 * X1 判定消费方：metrics/x1.ts（离线）与 #299 证据快照。纯日志路线，无 migration。
 */

import { appendFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { localDateKey } from './usage.js';
import { logger } from './logger.js';

export type ActivityKind = 'session';

export interface ActivityEntry {
  timestamp: string;
  /** 租户键（Casdoor sub） */
  tenantId: string;
  kind: ActivityKind;
}

/** 记录一条活跃到租户 activity 文件（no-throw） */
export async function recordTenantActivity(
  tenantDir: string,
  tenantId: string,
  kind: ActivityKind = 'session',
): Promise<void> {
  try {
    const dir = join(tenantDir, 'activity');
    await mkdir(dir, { recursive: true });
    const file = join(dir, `activity-${localDateKey()}.jsonl`);
    const line: ActivityEntry = { timestamp: new Date().toISOString(), tenantId, kind };
    await appendFile(file, JSON.stringify(line) + '\n', 'utf-8');
  } catch (error) {
    logger.warn('记录租户活跃失败（不影响主流程）', { error });
  }
}

/** activity 文件名日期（activity-YYYY-MM-DD.jsonl → 'YYYY-MM-DD'）；非法名 = null */
export function activityFileDate(file: string): string | null {
  const m = /^activity-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(file);
  return m ? m[1]! : null;
}

/**
 * 读租户活跃「日」集合（本地日期键，已去重升序）。
 * 时间范围 [from, to] 日期字符串，缺省全部。目录不存在 = 合法空态（租户从未
 * 回访）返回空集；半行写入（崩溃残留）与坏行跳过，不拖垮判定。
 */
export async function readTenantActivityDays(
  tenantDir: string,
  from?: string,
  to?: string,
): Promise<string[]> {
  const dir = join(tenantDir, 'activity');
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; // 从未活跃 = 合法空态
    throw error;
  }
  // 活跃日一律取文件名（本地日，写入口径 localDateKey）；文件由首条记录
  // appendFile 时创建，「文件存在 = 该本地日有过活跃」。逐行 timestamp 是
  // UTC 日，与 D0 的本地日口径混用会错切 X1 窗口（PR #303 review P1-1）。
  const days = new Set<string>();
  for (const file of files) {
    const fileDate = activityFileDate(file);
    if (!fileDate) continue;
    if (from && fileDate < from) continue;
    if (to && fileDate > to) continue;
    days.add(fileDate);
  }
  return [...days].sort();
}
