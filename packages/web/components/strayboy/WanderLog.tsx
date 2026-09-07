"use client";

import type { WanderStep } from "@/lib/types";

/** WanderLog 4 行（components.md §游戏屏：游戏 log 不留历史，历史在 LOG 存档抽屉）。 */
export function WanderLog({ history }: { history: WanderStep[] }) {
  return (
    <section
      aria-label="游荡日志"
      className="border-2 border-black bg-black p-3 font-vt323 text-[20px] leading-[1.5] text-[var(--ok)]"
    >
      {/* 注入数组尾部最新（CP slice(-20)）——展示最新 4 条，按时间正序排终端行。
          markdown 粗体记号展示层剥除（原文渲染归后续详情票） */}
      {history.slice(-4).map((step, i) => (
        <p key={i}>&gt; {(step.spoke ?? step.thought ?? step.url ?? `${step.tool} 逛了一圈。`).replace(/\*\*/g, "")}</p>
      ))}
      {history.length === 0 && <p>&gt; 等待第一次出门的信号……</p>}
    </section>
  );
}
