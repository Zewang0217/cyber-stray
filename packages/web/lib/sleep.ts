/**
 * 作息睡眠判定（#91，前端展示用）
 *
 * 与 control-plane 的 `scheduler/sleep.ts#isSleeping` 逻辑镜像（半开区间
 * [start, end)，跨午夜，null = 永不睡眠）。两个包无法共享模块（web 是
 * Next.js 客户端包，control-plane 是 Bun 服务端包），改动必须同步两侧。
 *
 * 时区：前端用**浏览器本地时区**的小时（用户视角）；调度器用服务器本地
 * 时区。单用户自托管部署通常一致；多时区部署时展示以用户本地为准，属
 * 有意取舍（与 issue #91 约定一致）。
 */

/** 是否睡眠中（浏览器本地小时 + 作息窗口；null 窗口 = 永不睡眠） */
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
