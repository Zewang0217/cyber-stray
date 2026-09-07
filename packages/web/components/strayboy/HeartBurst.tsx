"use client";

/**
 * 像素爱心 ×3 上飘（motion.md §4 拍拍编排：f8 each）。
 * 方块爱心（字符级像素，禁平滑图标）；动画纯 CSS，播完由父级卸载。
 */
export function HeartBurst() {
  const hearts = [
    { left: "18%", delay: "0s" },
    { left: "44%", delay: "0.12s" },
    { left: "70%", delay: "0.24s" },
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-16 h-16">
      {hearts.map((h, i) => (
        <span
          key={i}
          className="absolute bottom-0 text-[16px] leading-none text-[var(--hi)] sb-heart"
          style={{ left: h.left, animationDelay: h.delay }}
        >
          ♥
        </span>
      ))}
    </div>
  );
}
