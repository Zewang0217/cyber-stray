"use client";

import { motion } from "framer-motion";
import type { InterestNodeData, InterestSource } from "@/lib/types";

interface InterestBarsProps {
  nodes: InterestNodeData[];
}

/** 来源 → 颜色映射（复用 Catppuccin 色彩系统） */
const SOURCE_COLORS: Record<InterestSource, string> = {
  default: "var(--color-success)",
  reflection: "var(--color-accent-blue)",
  feedback: "var(--color-accent)",
};

const SOURCE_LABELS: Record<InterestSource, string> = {
  default: "种子",
  reflection: "反思",
  feedback: "反馈",
};

/**
 * 兴趣权重水平柱状图。
 *
 * 按有效权重降序排列，每行显示兴趣名称、权重条和百分比。
 * 颜色按来源区分，含 stagger 入场动画。
 */
export function InterestBars({ nodes }: InterestBarsProps): React.ReactElement {
  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-subtext text-sm">
        暂无兴趣数据。启动 Agent 后将自动生成兴趣图谱。
      </div>
    );
  }

  // 按有效权重降序排列
  const sorted = [...nodes].sort(
    (a, b) => b.effectiveWeight - a.effectiveWeight,
  );

  return (
    <div className="space-y-3">
      {sorted.map((node, index) => {
        const color = SOURCE_COLORS[node.source] ?? "var(--color-success)";
        const label = SOURCE_LABELS[node.source] ?? node.source;
        const percent = Math.round(node.effectiveWeight * 100);

        return (
          <motion.div
            key={node.id}
            className="flex items-center gap-3"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              type: "spring",
              stiffness: 400,
              damping: 25,
              delay: index * 0.08,
            }}
          >
            {/* 标签区 */}
            <div className="w-24 shrink-0 text-right">
              <span className="text-sm font-medium text-text block truncate">
                {node.id}
              </span>
              <span className="text-xs text-subtext">{label}</span>
            </div>

            {/* 权重条 */}
            <div className="flex-1 h-6 rounded-md bg-surface/50 overflow-hidden relative">
              <motion.div
                className="h-full rounded-md"
                style={{
                  backgroundColor: color,
                  opacity: 0.7,
                }}
                initial={{ width: 0 }}
                animate={{ width: `${percent}%` }}
                transition={{
                  type: "spring",
                  stiffness: 200,
                  damping: 30,
                  delay: index * 0.08 + 0.1,
                }}
              />
            </div>

            {/* 百分比 */}
            <span
              className="w-10 shrink-0 text-right font-mono text-sm font-bold"
              style={{ color }}
            >
              {percent}%
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}
