"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  glowColor?: string;
}

/**
 * 玻璃态卡片容器
 * 悬浮时边框亮起霓虹渐变，背景保持 backdrop-blur
 */
export function GlassCard({
  children,
  className = "",
  glowColor = "var(--color-accent)",
}: GlassCardProps): React.ReactElement {
  return (
    <motion.div
      className={cn(
        "relative p-6 rounded-2xl bg-mantle/60 border border-surface backdrop-blur-sm overflow-hidden group hover:border-accent/20 transition-colors",
        className
      )}
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
    >
      {/* 悬浮发光边框 */}
      <div
        className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{
          boxShadow: `inset 0 0 0 1px ${glowColor}30, 0 0 20px -5px ${glowColor}20`,
        }}
      />

      <div className="relative">{children}</div>
    </motion.div>
  );
}
