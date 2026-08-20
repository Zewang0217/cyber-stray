/**
 * 表情包配额/频率控制（#96）—— 防成本失控
 *
 * 口径：当天（YYYY-MM-DD）已收录（qcPass=true）的表情包数。失败/质检不过的
 * 不占额度——只有真正进图鉴的才消耗成本配额（与 #94 petgen 同语义：失败不占）。
 * 上限由 pipeline 配置注入（dailyLimit；0 = 不限）。manifest 即计数源，无需
 * 并行计数器（与 push-budget 文件级顺序扫同构）。
 */

import { loadManifest } from './storage.js';

/** 本地日期键（YYYY-MM-DD；与 manifest 元数据 date 对齐） */
export function localDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 今天已收录（qcPass）的表情包数 */
export async function countTodayMemes(
  dataDir: string,
  date: string,
): Promise<number> {
  const manifest = await loadManifest(dataDir);
  return manifest.filter((m) => m.date === date && m.qcPass).length;
}

/** 今日剩余配额（limit - used；limit 0 = 不限返回 Infinity） */
export async function memeQuotaRemaining(
  dataDir: string,
  limit: number,
  date: string,
): Promise<number> {
  if (limit <= 0) return Number.POSITIVE_INFINITY;
  const used = await countTodayMemes(dataDir, date);
  return Math.max(0, limit - used);
}
