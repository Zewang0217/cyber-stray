"use client";

/**
 * 反馈落定的一瞬（motion.md 两帧法则）：赞 = ♥ 上飘（sb-heart，与拍拍同语法）；
 * 踩 = 灰方块下坠（sb-pip）。字符/方块级像素，播完由父级卸载。
 */
export function FeedbackBurst({ type }: { type: "like" | "dislike" }) {
  const bits = [
    { left: "10%", delay: "0s" },
    { left: "42%", delay: "0.1s" },
    { left: "74%", delay: "0.2s" },
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-2 bottom-full h-12">
      {bits.map((b, i) =>
        type === "like" ? (
          <span
            key={i}
            className="sb-heart absolute bottom-0 text-[14px] leading-none text-[var(--hi)]"
            style={{ left: b.left, animationDelay: b.delay }}
          >
            ♥
          </span>
        ) : (
          <span
            key={i}
            className="sb-pip absolute top-0 h-[6px] w-[6px] bg-[var(--curb)]"
            style={{ left: b.left, animationDelay: b.delay }}
          />
        ),
      )}
    </div>
  );
}
