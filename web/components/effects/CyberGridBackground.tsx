"use client";

import { motion } from "framer-motion";

/**
 * 赛博网格背景动效
 * 缓慢流动的网格线，营造暗巷游荡氛围
 * 使用语义颜色变量，支持主题切换
 */
export function CyberGridBackground(): React.ReactElement {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      {/* 深色底 */}
      <div className="absolute inset-0 bg-crust" />
      {/* 网格线 */}
      <motion.div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: `
            linear-gradient(to right, var(--color-accent) 1px, transparent 1px),
            linear-gradient(to bottom, var(--color-accent) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
        animate={{
          backgroundPosition: ["0px 0px", "60px 60px"],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: "linear",
        }}
      />
      {/* 径向暗角 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 0%, var(--color-crust) 80%)",
        }}
      />
    </div>
  );
}
