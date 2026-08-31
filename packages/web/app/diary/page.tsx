"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { PageHeader } from "@/components/ui/PageHeader";
import { spring } from "@/components/ui/motion";

interface DiaryEntry {
  date: string;
  title: string;
  content: string;
  excerpt?: string;
}

/**
 * 日记页（#92）：宠物每天睡前生成的性格化日记时间线。
 * 数据源 diary/YYYY-MM-DD.md，由睡前任务（diary-cli）落盘。
 */
export default function DiaryPage(): React.ReactElement {
  const [entries, setEntries] = useState<DiaryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // prefers-reduced-motion:时间轴节点弹跳降级为淡入
  const reduced = useReducedMotion();

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/diary");
      const json = (await res.json()) as { success: boolean; error?: string; data?: DiaryEntry[] };
      if (json.success && json.data) {
        setEntries(json.data);
        setError(null);
      } else {
        setError(json.error ?? "加载失败");
      }
    } catch {
      setError("网络错误");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** 显示日期（2026-08-20 → 8月20日） */
  const prettyDate = (date: string): string => {
    const m = Number(date.slice(5, 7));
    const d = Number(date.slice(8, 10));
    return `${m}月${d}日`;
  };

  return (
    <div className="spacing-lg max-w-4xl mx-auto">
      <PageHeader
        kicker="Ephemeris"
        title="日记"
        subtitle={<>宠物每天睡前的性格化日记 {entries ? `· 共 ${entries.length} 篇` : ""}</>}
      />

      {!entries ? (
        <p className="text-body text-subtext">加载中…</p>
      ) : entries.length === 0 ? (
        <motion.div className="p-6 paper-card rounded-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <p className="text-body text-subtext">
            还没有日记——宠物睡前会生成第一篇，每天一篇，按它的性格来写。
          </p>
        </motion.div>
      ) : (
        <div className="relative pl-6 border-l-2 border-[var(--c-engraving-fine)]">
          {entries.map((e, i) => (
            <motion.div
              key={e.date}
              className="relative mb-6"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i * 0.05, 0.4) }}
            >
              {/* 时间轴节点 */}
              <motion.span
                className="absolute -left-[30px] top-2 w-3 h-3 rounded-full bg-[var(--c-amber)]"
                initial={reduced ? { opacity: 0 } : { scale: 0 }}
                animate={reduced ? { opacity: 1 } : { scale: 1 }}
                transition={{
                  ...spring,
                  delay: Math.min(i * 0.05, 0.4) + 0.15,
                }}
              />
              <div className="p-5 paper-card rounded-sm">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-heading text-body font-semibold text-text">{e.title}</h2>
                  <span className="text-xs text-subtext font-mono">{prettyDate(e.date)}</span>
                </div>
                <div className="text-small text-text whitespace-pre-wrap leading-relaxed">
                  {e.content
                    .split("\n")
                    .filter((line) => !line.startsWith("#") && !line.startsWith("---") && line.trim() !== "")
                    .join("\n")}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
      {error ? <p className="text-small text-danger mt-3">{error}</p> : null}
    </div>
  );
}
