/**
 * 触觉反馈（spec US25）：移动端轻震动；尊重 prefers-reduced-motion；
 * 桌面/不支持设备静默。
 */
export function vibrate(ms: number): void {
  if (typeof window === "undefined" || !("vibrate" in navigator)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  navigator.vibrate(ms);
}
