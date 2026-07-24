"use client";

import { motion } from "framer-motion";

/**
 * 红色呼吸灯脉冲边框
 * 当 Agent 处于饥饿/无聊爆表状态时显示
 * 使用语义颜色变量
 */
export function PulseBorder(): React.ReactElement {
  return (
    <motion.div
      className="fixed inset-0 pointer-events-none z-[100]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div
        className="absolute inset-0 rounded-none"
        style={{
          boxShadow: "inset 0 0 60px 10px oklch(0.658 0.222 18 / 0.15)",
          animation: "pulse-border 2s ease-in-out infinite",
        }}
      />
    </motion.div>
  );
}
