"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Megaphone } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { spring } from "@/components/ui/motion";

interface FootprintStep {
  timestamp: string;
  tool: string;
  thought?: string;
  url?: string;
  spoke?: boolean;
}

/**
 * 足迹页（S14）：宠物每次游荡的每一个步骤（tool/thought/url/spoke）。
 * 数据源 wander-history.json，由 agent 每步落盘。
 */
export default function FootprintPage(): React.ReactElement {
  const [steps, setSteps] = useState<FootprintStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // prefers-reduced-motion:时间轴节点弹跳降级为淡入
  const reduced = useReducedMotion();

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/footprint");
      const json = (await res.json()) as { success: boolean; error?: string; data?: FootprintStep[] };
      if (json.success && json.data) {
        setSteps(json.data);
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

  // 工具名 → 展示标签;颜色遵循 Restrained:表达(speak)=琥珀生命色,其余=墨色系
  const toolLabel = (tool: string): string =>
    ({ search_web: "搜索", browse_page: "浏览", speak: "表达", reflect: "反思", plan: "计划" })[tool] ?? tool;
  const toolColor = (tool: string): string =>
    tool === "speak" ? "var(--c-amber)" : "var(--c-ink)";
  const toolTextColor = (tool: string): string =>
    tool === "speak" ? "var(--c-amber-ink)" : "var(--c-faded-ink)";

  return (
    <div className="spacing-lg max-w-4xl mx-auto">
      <PageHeader
        kicker="Itinerarium"
        title="足迹"
        subtitle={<>宠物每次游荡的每一个步骤 {steps ? `· 共 ${steps.length} 步` : ""}</>}
      />

      {!steps ? (
        <p className="text-body text-subtext">加载中…</p>
      ) : steps.length === 0 ? (
        <motion.div
          className="p-6 paper-card rounded-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <p className="text-body text-subtext">还没有足迹——宠物游荡后这里会显示每一步。</p>
        </motion.div>
      ) : (
        <div className="relative pl-6 border-l-2 border-[var(--c-engraving-fine)]">
          {steps.map((s, i) => (
            <motion.div
              key={i}
              className="relative mb-5"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i * 0.02, 0.4) }}
            >
              {/* 时间轴节点 */}
              <motion.span
                className="absolute -left-[30px] top-1.5 w-3 h-3 rounded-full"
                style={{ background: toolColor(s.tool) }}
                initial={reduced ? { opacity: 0 } : { scale: 0 }}
                animate={reduced ? { opacity: 1 } : { scale: 1 }}
                transition={{
                  ...spring,
                  delay: Math.min(i * 0.02, 0.4) + 0.15,
                }}
              />
              <div className="p-4 paper-card rounded-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="px-2 py-0.5 rounded-sm text-xs font-semibold border"
                    style={{
                      borderColor: toolColor(s.tool),
                      color: toolTextColor(s.tool),
                    }}
                  >
                    {toolLabel(s.tool)}
                  </span>
                  <span className="text-xs text-subtext font-mono">
                    {new Date(s.timestamp).toLocaleString()}
                  </span>
                  {s.spoke ? (
                    <span className="inline-flex items-center gap-1 text-xs text-[var(--c-amber-ink)] font-semibold">
                      <Megaphone className="w-3.5 h-3.5 shrink-0" aria-hidden />
                      推送
                    </span>
                  ) : null}
                </div>
                {s.thought ? (
                  <p className="text-small text-text whitespace-pre-wrap break-all">{s.thought}</p>
                ) : null}
                {s.url ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-[var(--c-amber-ink)] underline break-all"
                  >
                    {s.url}
                  </a>
                ) : null}
              </div>
            </motion.div>
          ))}
        </div>
      )}
      {error ? <p className="text-small text-danger mt-3">{error}</p> : null}
    </div>
  );
}
