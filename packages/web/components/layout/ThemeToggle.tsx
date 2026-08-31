"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import {
  THEMES,
  THEME_STORAGE_KEY,
  applyTheme,
  findTheme,
} from "@/lib/themes";
import { Tooltip } from "@/components/ui/Tooltip";
import { spring } from "@/components/ui/motion";

/**
 * 主题切换器(图鉴卷循环:日→夜→春→秋)
 * 数据驱动:主题值全部来自 lib/themes.ts,此处零主题色字面量。
 * 持久化 localStorage;首帧由 layout 内联脚本应用(无闪烁)。
 */
export function ThemeToggle(): React.ReactElement {
  const [current, setCurrent] = useState(THEMES[0]!);
  // prefers-reduced-motion:字形翻转降级为淡入
  const reduced = useReducedMotion();

  // 挂载时恢复已选主题(内联脚本已应用样式,这里只同步 UI 状态)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      setCurrent(findTheme(saved));
    } catch {
      // 存储不可用:保持默认
    }
  }, []);

  const cycle = () => {
    const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]!;
    setCurrent(next);
    applyTheme(next);
  };

  return (
    <Tooltip content={current.label}>
      <motion.button
        onClick={cycle}
        className="relative px-2 py-1 rounded-sm bg-[var(--c-paper)] border border-[var(--c-engraving-fine)] hover:border-[var(--c-amber)] transition-colors"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        aria-label={`切换图鉴卷(当前:${current.label})`}
      >
        <span
          key={current.glyph}
          className="field-note text-sm text-text leading-none inline-block"
        >
          <motion.span
            className="inline-block"
            initial={reduced ? { opacity: 0 } : { rotateX: 90, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { rotateX: 0, opacity: 1 }}
            transition={spring}
            style={{ transformOrigin: "center" }}
          >
            {current.glyph}
          </motion.span>
        </span>
      </motion.button>
    </Tooltip>
  );
}
