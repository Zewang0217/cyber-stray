/**
 * 真实作息睡眠判定（#91）
 *
 * 纯函数：给定本地小时 + 作息窗口 → 是否睡眠中。睡眠中调度器跳过游荡
 * （不拉 worker，游荡计数不增长），醒来后下一 tick 自动恢复。
 *
 * 窗口语义：半开区间 [sleepStart, sleepEnd)（与 issue 定义一致）——
 * 设 22-7 即 22:00 入睡、7:00 醒来（22/23/0…6 睡眠中，7 起清醒）。
 * - 跨午夜：start > end 时落在 [start, 24) ∪ [0, end)
 * - 未设置（任一为 null）= 永不睡眠，行为与现状完全一致
 * - start === end = 空区间 = 永不睡眠（API 层拒绝该输入，此处防御）
 *
 * 时区语义：与推送窗口（pushWindowStart/End）对齐——输入小时是**进程本地
 * 时区**的小时。调度器用 `new Date(now).getHours()`（服务器本地时区）；
 * 前端展示用浏览器本地时区（单用户自托管部署通常一致，多时区部署时前端
 * 展示仍以用户本地时间为准，调度以服务器时间为准，属有意取舍）。
 */

/** 是否睡眠中（本地小时 + 作息窗口；null 窗口 = 永不睡眠） */
export function isSleeping(
  localHour: number,
  sleepStart: number | null,
  sleepEnd: number | null,
): boolean {
  if (sleepStart === null || sleepEnd === null) return false;
  if (sleepStart <= sleepEnd) return localHour >= sleepStart && localHour < sleepEnd;
  // 跨午夜：[start, 24) ∪ [0, end)
  return localHour >= sleepStart || localHour < sleepEnd;
}
