/**
 * 睡前任务触发判定（#92 日记系统）
 *
 * 纯函数：给定本地小时 + 作息窗口 + 上次日记日期 + 上次 tick 睡眠态，
 * 判断"现在是否该生成今天日记"。
 *
 * 触发语义：
 * - **有作息配置**：睡眠开始（本 tick 刚进入睡眠窗口，即 awake→asleep 跳变）
 *   触发，日记日期 = 触发当天的日历日（= 入睡日）。跨午夜的同一段睡眠
 *   不重复触发（wasSleeping 跳变只在进入窗口瞬间为 true；lastDiaryDate 兜底
 *   同日不重跑）。调度器重启跨午夜的边界：首 tick 播种当前睡眠态（不触发），
 *   醒来再睡才触发——重启不会在睡眠中段多生成一篇。
 * - **无作息配置**（默认租户）：固定每日时刻（DIARY_FALLBACK_HOUR，本地 23 点）
 *   触发一次，日记日期 = 当天。由 lastDiaryDate === today 去重。
 *
 * 与 #91 的 isSleeping 语义对齐（窗口 [start, end)，跨午夜 [start,24)∪[0,end)）。
 */

import { isSleeping } from './sleep.js';

/** 无作息租户（默认）的固定日记触发时刻（本地小时，24h 制） */
export const DIARY_FALLBACK_HOUR = 23;

/** 日记触发判定入参 */
export interface DiaryTriggerParams {
  /** 进程本地小时（与 isSleeping 对齐） */
  localHour: number;
  /** 当天日期（YYYY-MM-DD，日记文件名与去重基准） */
  today: string;
  sleepStart: number | null;
  sleepEnd: number | null;
  /** 上次生成日记的日期（null = 从未生成） */
  lastDiaryDate: string | null;
  /** 上次 tick 是否睡眠中（跨 tick 记忆；调度器首 tick 播种当前态） */
  wasSleeping: boolean;
}

/** 现在是否该生成当天日记 */
export function shouldGenerateDiary(params: DiaryTriggerParams): boolean {
  // 今天已生成 → 不再触发（同日去重）
  if (params.lastDiaryDate === params.today) return false;

  if (params.sleepStart !== null && params.sleepEnd !== null) {
    const sleeping = isSleeping(params.localHour, params.sleepStart, params.sleepEnd);
    // 睡眠开始（本 tick 刚进入睡眠）触发；睡眠中持续不重复
    return sleeping && !params.wasSleeping;
  }

  // 无作息：固定每日时刻触发一次
  return params.localHour === DIARY_FALLBACK_HOUR;
}
