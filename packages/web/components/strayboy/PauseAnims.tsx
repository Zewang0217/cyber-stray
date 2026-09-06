"use client";

import { useEffect } from "react";

/**
 * motion.md §5 红线：页面不可见时停所有无限动画。
 * 落地为 body.sb-hidden 切换（globals.css 据此暂停 animation）；
 * 用暂停而非移除动画——恢复时不停在首帧、不重播入场动画。
 */
export function PauseAnims() {
  useEffect(() => {
    const onChange = () => {
      document.body.classList.toggle("sb-hidden", document.visibilityState === "hidden");
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return null;
}
