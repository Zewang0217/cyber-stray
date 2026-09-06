"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { InterestNodeData } from "@/lib/types";

/** 兴趣来源方签（NES 语义色：reflection=act / feedback=ok / default=curb）。 */
const SOURCE_STYLE: Record<string, string> = {
  reflection: "text-[var(--act)]",
  feedback: "text-[var(--ok)]",
  default: "text-[var(--curb)]",
};

/**
 * 图鉴条目轨道（#170）：按有效权重排序的条目行——编号/话题名/像素墨条/
 * 强化计数/来源方签。新条目首次出现翻转亮起（f12，motion.md §4）。
 */
export function InterestAtlas({ nodes }: { nodes: InterestNodeData[] }) {
  const sorted = useMemo(
    () => [...nodes].sort((a, b) => b.effectiveWeight - a.effectiveWeight),
    [nodes],
  );
  const seen = useRef<Set<string> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  // 新条目检测：首帧记录基线，其后新出现的 id 标记「刚叼回来」并翻转亮起。
  // 定时器持 ref——重渲染不重置 2s 收尾（评审 #190 P1）。
  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(sorted.map((n) => n.id));
      return;
    }
    const freshIds = sorted.filter((n) => !seen.current!.has(n.id));
    if (freshIds.length > 0) {
      setFresh(new Set(freshIds.map((n) => n.id)));
      for (const n of freshIds) seen.current!.add(n.id);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setFresh(new Set());
      }, 2000);
    }
  }, [sorted]);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  if (sorted.length === 0) {
    return <p className="py-12 text-center text-[14px] text-[var(--curb)]">图鉴空空如也。等它第一次带回话题。</p>;
  }

  return (
    <ol className="flex flex-col gap-2.5">
      {sorted.map((n, i) => {
        const cells = Math.max(1, Math.round(n.effectiveWeight * 10));
        const isNew = fresh.has(n.id);
        return (
          <li
            key={n.id}
            className={`border-2 border-[var(--ink)] bg-[var(--paper)] p-3 shadow-[4px_4px_0_#000] ${isNew ? "sb-flip-in" : ""}`}
          >
            <div className="flex items-center gap-3">
              <span className="font-ps2p text-xs text-[var(--ink)]">No.{i + 1}</span>
              <span className="flex-1 text-[15px] text-[var(--ink)]">{n.id}</span>
              <span className={`font-vt323 text-[20px] ${SOURCE_STYLE[n.source] ?? SOURCE_STYLE.default}`}>
                ×{n.reinforceCount}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2 pl-9">
              <div aria-label={`有效权重 ${Math.round(n.effectiveWeight * 100)}%`} className="flex h-3.5 flex-1 gap-[2px] border-2 border-black bg-[var(--window-off)] p-[2px]">
                {Array.from({ length: 10 }, (_, k) => (
                  <b key={k} className={`flex-1 ${k < cells ? "bg-[var(--hi)]" : "bg-[var(--street)]"}`} />
                ))}
              </div>
              <span className={`text-[11px] ${SOURCE_STYLE[n.source] ?? SOURCE_STYLE.default}`}>
                {n.source === "reflection" ? "自省" : n.source === "feedback" ? "反馈" : "初始"}
              </span>
            </div>
            {isNew && (
              <p className="mt-1 pl-9 text-[12px] text-[var(--bad)]">叼回来一个新话题！</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
