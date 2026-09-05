/**
 * 推送预算（S11，#78）
 *
 * 日预算统计"今天已落盘的可通知记录"（speak 收口，与 push-gateway 的
 * 可通知判定同构：gated/planLimited 均不计）。文件级顺序扫，短命 worker
 * 一轮最多几百行，无需索引。
 *
 * 日期键：speaks-<本地日期>.jsonl 按**本地日期**命名（appendSpeakHistory
 * 同源）——"每天 N 条"是用户视角的本地日。文件即当日范围，计数不再做
 * 时间戳比对，天然免疫 UTC/本地日期错位（曾用 UTC 文件名 + 本地键比对，
 * UTC+8 每日 0-8 点计数恒 0，可绕过上限）。
 */

import { readFile } from 'fs/promises';

/** 本地当前小时（0-23） */
export function localHour(now: Date = new Date()): number {
  return now.getHours();
}

/**
 * 是否在推送时间窗内。
 * 窗口 null = 全天。start/end 均为闭端点（用户设 9-22 即 9:00–22:59）。
 * start > end 视为跨午夜窗口（22-6 = 22:00–6:59）。
 */
export function withinPushWindow(
  hour: number,
  start: number | null | undefined,
  end: number | null | undefined,
): boolean {
  if (start === null || start === undefined || end === null || end === undefined) return true;
  if (start === end) return true; // 退化窗口（路由已禁，防御）全天
  if (start < end) return hour >= start && hour <= end;
  // 跨午夜：[start,23] ∪ [0,end]
  return hour >= start || hour <= end;
}

/** 本地日期键（YYYY-MM-DD；与 speaks-*.jsonl 文件名同源，见 appendSpeakHistory） */
export function localDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** speaks 历史文件名的单一出处（appendSpeakHistory / recent-speaks 共用，防命名漂移） */
export function speaksFile(date: Date = new Date()): string {
  return `speaks-${localDateKey(date)}.jsonl`;
}

/** 今日 speaks 历史文件名（与 appendSpeakHistory 完全同源） */
export function todaySpeaksFile(): string {
  return speaksFile();
}

/**
 * 统计今天已落盘的可通知记录数（日预算已用量）。
 * gated/planLimited 记录不计：前者"仅学习"不占额度，后者"被拦下"也
 * 不占——预算只数真正放行并落盘的内容（含 pushed=false 但门控放行的
 * 纯 PWA 场景）。
 */
export async function countGatePassedToday(historyFile: string): Promise<number> {
  let content: string;
  try {
    content = await readFile(historyFile, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
  let count = 0;
  for (const line of content.split('\n')) {
    if (!line) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (record.gated === true) continue;
    if (record.planLimited === true) continue;
    count++;
  }
  return count;
}
