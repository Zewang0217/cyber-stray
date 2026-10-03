/**
 * 作息睡眠判定（纯函数；CP 调度与 web 展示共用同一定义）。
 *
 * 窗口语义：半开区间 [sleepStart, sleepEnd)——设 22-7 即 22:00 入睡、7:00 醒来；
 * 跨午夜（start > end）= [start, 24) ∪ [0, end)；
 * 任一端 null = 未设置作息 = 永不睡眠；start === end = 空区间（API 层已拒绝，此处防御）。
 *
 * 时区语义：输入是调用方本地小时——调度器传服务器时区（调度口径），
 * 前端传浏览器时区（展示口径）。多时区部署下两者可能不一致，属有意取舍。
 */
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
