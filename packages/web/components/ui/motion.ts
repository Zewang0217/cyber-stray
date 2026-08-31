"use client";

import type { Transition, Variants } from "framer-motion";

/**
 * 共享动画语言(图鉴世界统一入场)
 * DESIGN.md:spring(stiffness 300, damping 28——翻页质感而非弹球)。
 * 所有页面的标题/区块/列表入场统一引用这里,不再各写各的 spring 参数。
 */

/** 统一 spring(图鉴翻页质感) */
export const spring: Transition = { type: "spring", stiffness: 300, damping: 28 };

/** 页面头部入场(kicker + 标题 + 分隔线) */
export const pageHeader: Variants = {
  hidden: { opacity: 0, y: -12 },
  visible: { opacity: 1, y: 0, transition: spring },
};

/** 列表错落入场(推送流/读数行) */
export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.15 },
  },
};

/** 列表单项(FieldNote/FeedCard 等) */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: spring },
};
