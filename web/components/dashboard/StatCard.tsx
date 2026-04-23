"use client";

import { motion } from "framer-motion";

interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
}

/**
 * 统计卡片
 * 展示总狩猎次数、总推送次数等数据
 * 使用等宽字体，带连字
 */
export function StatCard({
  label,
  value,
  unit,
  color = "var(--color-accent)",
}: StatCardProps): React.ReactElement {
  return (
    <motion.div
      className="relative p-5 rounded-2xl bg-mantle/60 border border-surface backdrop-blur-sm overflow-hidden group hover:border-accent/20 transition-colors"
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
    >
      {/* 悬浮发光边框 - 使用 CSS 类而非 Framer Motion 动画颜色 */}
      <div
        className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{
          boxShadow: `inset 0 0 0 1px ${color}30, 0 0 20px -5px ${color}20`,
        }}
      />

      <div className="relative">
        <p className="text-xs font-medium text-subtext uppercase tracking-wider mb-2">
          {label}
        </p>
        <div className="flex items-baseline gap-1">
          <span
            className="font-mono text-2xl font-bold tabular-nums"
            style={{ color }}
          >
            {value}
          </span>
          {unit && (
            <span className="text-xs text-subtext font-mono">{unit}</span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
