"use client";

import type { WanderStep } from "@/lib/types";

/** WanderLog 4 行（components.md §游戏屏：游戏 log 不留历史，历史在 LOG 存档抽屉）。 */
export function WanderLog({ history }: { history: WanderStep[] }) {
  return (
    <section
      aria-label="游荡日志"
      className="border-2 border-black bg-black p-3 font-vt323 text-[20px] leading-[1.5] text-[var(--ok)]"
    >
      {history.slice(0, 4).map((step, i) => (
        <p key={i}>&gt; {step.spoke ?? step.thought ?? step.url ?? `${step.tool} 逛了一圈。`}</p>
      ))}
      {history.length === 0 && <p>&gt; 还没出过门。它在等天黑。</p>}
    </section>
  );
}
