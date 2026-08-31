"use client";

import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/**
 * 页面过渡(图鉴翻页):路由切换时旧页向左滑出、新页自右滑入。
 * DESIGN.md:页面过渡模拟翻页(ease-in-out 0.4s)——此处 0.2s×2 + mode="wait"
 * 顺序执行,快而稳;initial={false} 首载不重复动画(各页自带入场)。
 * prefers-reduced-motion:显式降级为纯淡入淡出(useReducedMotion 快照,
 * 不依赖 MotionConfig 对 declarative/exit 路径的拦截)。
 * 注:侧栏在 main 之外,切换时保持稳定,只有内容区翻页。
 */
export function PageTransition({ children }: { children: React.ReactNode }): React.ReactElement {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={reduced ? { opacity: 0 } : { opacity: 0, x: 16 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, x: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, x: -16 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
