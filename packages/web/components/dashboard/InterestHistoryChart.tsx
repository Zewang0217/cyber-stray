"use client";

import { motion } from "framer-motion";
import type { InterestSnapshot } from "@/lib/types";

interface InterestHistoryChartProps {
  history: InterestSnapshot[];
}

/** 图表颜色调色板（最多支持 5 条线） */
const LINE_COLORS = [
  "var(--color-accent)",
  "var(--color-accent-blue)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-danger)",
];

/**
 * 兴趣权重时间序列折线图（简易 SVG 实现）。
 *
 * 只显示 top 5 节点，避免视觉噪音。
 * X 轴 = 时间，Y 轴 = 有效权重。
 */
export function InterestHistoryChart({
  history,
}: InterestHistoryChartProps): React.ReactElement {
  if (history.length < 2) {
    return (
      <div className="flex items-center justify-center py-6 text-subtext text-sm">
        需要至少 2 个快照才能显示趋势。继续运行 Agent 后数据会逐渐积累。
      </div>
    );
  }

  // 提取所有出现过的节点 ID，按最新权重排序取 top 5
  const nodeIds = new Set<string>();
  for (const snapshot of history) {
    for (const node of snapshot.nodes) {
      nodeIds.add(node.id);
    }
  }

  // 按最新快照中的权重排序
  const latestSnapshot = history[history.length - 1]!;
  const topNodeIds = [...nodeIds]
    .map((id) => {
      const node = latestSnapshot.nodes.find((n) => n.id === id);
      return { id, weight: node?.effectiveWeight ?? 0 };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map((n) => n.id);

  // SVG 尺寸
  const width = 600;
  const height = 200;
  const padding = { top: 10, right: 20, bottom: 30, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Y 轴范围 [0, 1]
  const yScale = (v: number) =>
    padding.top + chartHeight * (1 - Math.min(v, 1));

  // X 轴映射
  const firstTime = new Date(history[0]!.timestamp).getTime();
  const lastTime = new Date(
    history[history.length - 1]!.timestamp,
  ).getTime();
  const timeRange = lastTime - firstTime || 1;
  const xScale = (t: string) => {
    const ms = new Date(t).getTime();
    return padding.left + ((ms - firstTime) / timeRange) * chartWidth;
  };

  // 为每个 top 节点生成折线路径
  const lines = topNodeIds.map((nodeId, i) => {
    const points = history
      .map((snapshot) => {
        const node = snapshot.nodes.find((n) => n.id === nodeId);
        if (!node) return null;
        return {
          x: xScale(snapshot.timestamp),
          y: yScale(node.effectiveWeight),
        };
      })
      .filter(Boolean) as { x: number; y: number }[];

    const pathD =
      points.length > 0
        ? points
            .map((p, j) => (j === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
            .join(" ")
        : "";

    return { nodeId, pathD, points, color: LINE_COLORS[i % LINE_COLORS.length]! };
  });

  // X 轴标签（只显示首尾时间）
  const xLabels = [
    { label: formatTime(history[0]!.timestamp), x: xScale(history[0]!.timestamp) },
    {
      label: formatTime(history[history.length - 1]!.timestamp),
      x: xScale(history[history.length - 1]!.timestamp),
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
    >
      {/* 图例 */}
      <div className="flex flex-wrap gap-3 mb-3">
        {lines.map((line) => (
          <div key={line.nodeId} className="flex items-center gap-1.5">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: line.color }}
            />
            <span className="text-xs font-mono text-text">{line.nodeId}</span>
          </div>
        ))}
      </div>

      {/* SVG 图表 */}
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full"
          style={{ minWidth: 400 }}
        >
          {/* Y 轴网格线 */}
          {[0, 0.25, 0.5, 0.75, 1.0].map((v) => (
            <g key={v}>
              <line
                x1={padding.left}
                y1={yScale(v)}
                x2={width - padding.right}
                y2={yScale(v)}
                stroke="currentColor"
                className="text-surface/30"
                strokeDasharray="4 4"
              />
              <text
                x={padding.left - 8}
                y={yScale(v) + 4}
                textAnchor="end"
                className="text-xs text-subtext"
                fill="currentColor"
              >
                {Math.round(v * 100)}%
              </text>
            </g>
          ))}

          {/* X 轴标签 */}
          {xLabels.map((xl) => (
            <text
              key={xl.label}
              x={xl.x}
              y={height - 8}
              textAnchor="middle"
              className="text-xs text-subtext"
              fill="currentColor"
            >
              {xl.label}
            </text>
          ))}

          {/* 折线 */}
          {lines.map((line) => (
            <motion.path
              key={line.nodeId}
              d={line.pathD}
              fill="none"
              stroke={line.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 1.5, ease: "easeInOut" }}
            />
          ))}

          {/* 数据点 */}
          {lines.map((line) =>
            line.points.map((p, j) => (
              <motion.circle
                key={`${line.nodeId}-${j}`}
                cx={p.x}
                cy={p.y}
                r={3}
                fill={line.color}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 1.5 + j * 0.05 }}
              />
            )),
          )}
        </svg>
      </div>
    </motion.div>
  );
}

/** 格式化为简短时间 */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  } catch {
    return "";
  }
}
