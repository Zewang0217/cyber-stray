"use client";

import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import type { CollapseDetection } from "@/lib/types";

interface EntropyGaugeProps {
  collapse: CollapseDetection;
  nodeCount: number;
}

/**
 * 兴趣熵值仪表 + 坍缩告警。
 *
 * 显示当前 Shannon 熵与理论最大熵的对比。
 * 低熵时触发红色 PulseBorder 风格告警。
 */
export function EntropyGauge({
  collapse,
  nodeCount,
}: EntropyGaugeProps): React.ReactElement {
  // 熵值百分比（相对于最大熵）
  const maxEntropy = collapse.maxEntropy;
  const percentage =
    maxEntropy > 0 ? Math.min((collapse.entropy / maxEntropy) * 100, 100) : 0;

  const isWarning = collapse.isCollapsing;

  return (
    <div className="relative">
      {/* 坍缩告警边框 */}
      {isWarning && (
        <motion.div
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{
            // CSS 变量无法直接用于带 alpha 的 boxShadow，硬编码 red-500 等同色
            boxShadow: "0 0 20px rgba(239, 68, 68, 0.3), inset 0 0 20px rgba(239, 68, 68, 0.1)",
          }}
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      <div
        className={`p-5 rounded-2xl backdrop-blur-xl border ${
          isWarning
            ? "border-danger/30 bg-danger/[0.03]"
            : "bg-mantle/[0.05] border-white/10"
        }`}
      >
        <h3 className="font-heading text-sm font-bold text-text mb-3">
          兴趣熵值
        </h3>

        {/* 熵值显示 */}
        <div className="flex items-end gap-2 mb-2">
          <motion.span
            className={`font-mono text-2xl font-bold ${
              isWarning ? "text-danger" : "text-accent-blue"
            }`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            key={collapse.entropy.toFixed(2)}
          >
            {collapse.entropy.toFixed(2)}
          </motion.span>
          <span className="text-xs text-subtext mb-1">
            / {maxEntropy.toFixed(2)} bit
          </span>
        </div>

        {/* 简易进度条 */}
        <div className="h-2 rounded-full bg-surface/50 overflow-hidden mb-3">
          <motion.div
            className={`h-full rounded-full ${
              isWarning ? "bg-danger" : "bg-accent-blue"
            }`}
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ type: "spring", stiffness: 200, damping: 30 }}
          />
        </div>

        {/* 元信息 */}
        <div className="flex items-center justify-between text-xs text-subtext">
          <span>{nodeCount} 个兴趣节点</span>
          <span>
            {isWarning ? "⚠ 有坍缩风险" : "分布健康"}
          </span>
        </div>

        {/* 告警详情 */}
        {isWarning && collapse.warning && (
          <motion.div
            className="mt-3 p-2 rounded-lg bg-danger/10 border border-danger/20 flex items-start gap-2"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
            <p className="text-xs text-danger/90 leading-relaxed">
              {collapse.warning}
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}
