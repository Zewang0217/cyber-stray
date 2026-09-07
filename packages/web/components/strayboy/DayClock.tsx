"use client";

import { useEffect, useState } from "react";
import { usePets } from "@/hooks/usePets";

/** DAY N：领养日（pet.createdAt）起的自然日数；无会话/无宠物时占位 DAY 1。 */
function dayCount(createdAt: number | undefined, now: number | null): number {
  if (!createdAt || now === null) return 1;
  return Math.max(1, Math.floor((now - createdAt) / 86_400_000) + 1);
}

/**
 * DAY/N 时钟（DESIGN.md §5 顶栏）：N = 领养日起的自然日数 + HH:MM。
 * 数字 VT323 20px（DESIGN.md §3）；suppressHydrationWarning——SSR 与客户端
 * 首帧时间天然可能跨分，属预期差异。
 */
export function DayClock() {
  const { pets } = usePets();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = (): void => {
      setNow(new Date());
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);

  const hhmm = now
    ? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    : "--:--";

  return (
    <span className="font-vt323 text-[20px] leading-none text-[var(--star)]" suppressHydrationWarning>
      DAY {dayCount(pets[0]?.createdAt, now?.getTime() ?? null)} · {hhmm}
    </span>
  );
}
