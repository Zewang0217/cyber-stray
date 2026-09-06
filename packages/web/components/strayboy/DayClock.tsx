"use client";

import { useEffect, useState } from "react";

/**
 * DAY/N 时钟（DESIGN.md §5 顶栏）：N = 领养日起的自然日数 + HH:MM。
 * 领养日接线随街角票（useAgentState）；当前 N 为占位 1，时钟为真实本地时间。
 * 数字用 VT323 20px（DESIGN.md §3：VT323 20px+）。
 */
export function DayClock() {
  const [now, setNow] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow(
        `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
      );
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="font-vt323 text-[20px] leading-none text-[var(--star)]">
      DAY 1 · {now ?? "--:--"}
    </span>
  );
}
