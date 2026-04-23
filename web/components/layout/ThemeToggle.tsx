"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";

/**
 * 主题切换按钮
 * 使用 next-themes 实现全局暗/亮模式切换
 */
export function ThemeToggle(): React.ReactElement {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 避免 SSR 闪烁：未挂载时不渲染
  if (!mounted) {
    return (
      <div className="w-9 h-9 rounded-xl bg-surface/50 border border-surface" />
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <motion.button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="relative p-2 rounded-xl bg-surface/50 border border-surface hover:border-accent/30 transition-colors"
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      aria-label={isDark ? "切换到亮色模式" : "切换到暗色模式"}
    >
      <motion.div
        initial={false}
        animate={{ rotate: isDark ? 0 : 180 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        {isDark ? (
          <Moon className="w-5 h-5 text-accent" />
        ) : (
          <Sun className="w-5 h-5 text-warning" />
        )}
      </motion.div>
    </motion.button>
  );
}
