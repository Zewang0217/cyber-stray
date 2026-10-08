/**
 * 作息睡眠判定（纯函数；CP 调度与 web 展示共用同一定义）。
 *
 * 窗口语义：半开区间 [sleepStart, sleepEnd)——设 22-7 即 22:00 入睡、7:00 醒来；
 * 跨午夜（start > end）= [start, 24) ∪ [0, end)；
 * 任一端 null = 未设置作息 = 永不睡眠；start === end = 空区间（API 层已拒绝，此处防御）。
 *
 * 作息统一使用北京时间；调用方通过 sleepScheduleHour 取得小时，避免容器
 * UTC 与浏览器本地时区造成同一只宠物在前后端的睡眠状态不同。
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

export const PET_SLEEP_TIME_ZONE = 'Asia/Shanghai';
const sleepHourFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: PET_SLEEP_TIME_ZONE, hour: '2-digit', hourCycle: 'h23',
});

/** 返回统一作息时区的小时，不依赖进程 TZ 或浏览器所在地。 */
export function sleepScheduleHour(now: Date): number {
  return Number(sleepHourFormatter.format(now));
}
