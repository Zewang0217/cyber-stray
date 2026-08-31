"use client";

import { MotionConfig } from "framer-motion";

interface ProvidersProps {
  children: React.ReactNode;
}

/**
 * 全局 Provider 包装
 * 图鉴世界 light-first:纸色底是默认(:root token)。夜读/烛光通过
 * html.night 切换,由 ThemeToggle 直接管理 class——不再需要 next-themes。
 * MotionConfig reducedMotion="user":prefers-reduced-motion 用户全局停用
 * framer 的 transform/layout 动画(位移/翻转/缩放),保留 opacity 淡入;
 * CSS 动画由 globals.css 的收敛规则兜底。
 */
export function Providers({ children }: ProvidersProps): React.ReactElement {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
