"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";

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

  // 工具名 → 展示标签 + 颜色
  const toolLabel = (tool: string): string =>
    ({ search_web: "搜索", browse_page: "浏览", speak: "表达", reflect: "反思", plan: "计划" })[tool] ?? tool;
  const toolColor = (tool: string): string =>
    tool === "speak" ? "#e06c3e" : tool === "browse_page" ? "#2f6fb0" : tool === "search_web" ? "#2f9e5f" : "#888";

  return (
    <div className="spacing-lg max-w-4xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        <h1 className="font-heading text-heading font-bold text-text mb-1">足迹</h1>
        <p className="text-body text-subtext mb-6">
          宠物每次游荡的每一个步骤 {steps ? `· 共 ${steps.length} 步` : ""}
        </p>
      </motion.div>

      {!steps ? (
        <p className="text-body text-subtext">加载中…</p>
      ) : steps.length === 0 ? (
        <motion.div
          className="p-6 rounded-2xl backdrop-blur-xl bg-mantle/[0.05] border border-white/10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <p className="text-body text-subtext">还没有足迹——宠物游荡后这里会显示每一步。</p>
        </motion.div>
      ) : (
        <div className="relative pl-6 border-l-2 border-white/10">
          {steps.map((s, i) => (
            <motion.div
              key={i}
              className="relative mb-5"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i * 0.02, 0.4) }}
            >
              {/* 时间轴节点 */}
              <span
                className="absolute -left-[30px] top-1.5 w-3 h-3 rounded-full"
                style={{ background: toolColor(s.tool) }}
              />
              <div className="p-4 rounded-2xl backdrop-blur-xl bg-mantle/[0.05] border border-white/10">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="px-2 py-0.5 rounded-lg text-xs font-bold"
                    style={{ background: `${toolColor(s.tool)}22`, color: toolColor(s.tool) }}
                  >
                    {toolLabel(s.tool)}
                  </span>
                  <span className="text-xs text-subtext font-mono">
                    {new Date(s.timestamp).toLocaleString()}
                  </span>
                  {s.spoke ? (
                    <span className="text-xs text-accent font-semibold">📣 推送</span>
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
                    className="text-xs text-accent underline break-all"
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
