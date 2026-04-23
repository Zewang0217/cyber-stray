"use client";

import { motion } from "framer-motion";
import type { Mood } from "@/lib/types";

interface MoodBadgeProps {
  mood: Mood;
}

/**
 * 心情标签
 * 不同心情映射不同颜色和微动画
 * 使用 CSS color-mix 实现透明度，避免 Framer Motion 颜色动画警告
 */
export function MoodBadge({ mood }: MoodBadgeProps): React.ReactElement {
  const moodConfig: Record<
    Mood,
    { label: string; colorVar: string; emoji: string }
  > = {
    curious: {
      label: "好奇",
      colorVar: "var(--color-accent-blue)",
      emoji: "🔍",
    },
    grumpy: {
      label: "暴躁",
      colorVar: "var(--color-danger)",
      emoji: "😤",
    },
    playful: {
      label: " playful",
      colorVar: "var(--color-warning)",
      emoji: "🎮",
    },
    lazy: {
      label: "慵懒",
      colorVar: "var(--color-subtext)",
      emoji: "😴",
    },
    excited: {
      label: "兴奋",
      colorVar: "var(--color-accent)",
      emoji: "🤩",
    },
    emo: {
      label: " emo",
      colorVar: "var(--color-overlay)",
      emoji: "🌧️",
    },
  };

  const config = moodConfig[mood];

  return (
    <motion.div
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border"
      style={{
        borderColor: `color-mix(in oklch, ${config.colorVar} 25%, transparent)`,
        backgroundColor: `color-mix(in oklch, ${config.colorVar} 8%, transparent)`,
      }}
      animate={
        mood === "excited"
          ? { y: [0, -4, 0], transition: { repeat: Infinity, duration: 1 } }
          : {}
      }
    >
      <span className="text-sm">{config.emoji}</span>
      <span
        className="text-sm font-medium"
        style={{ color: config.colorVar }}
      >
        {config.label}
      </span>
    </motion.div>
  );
}
