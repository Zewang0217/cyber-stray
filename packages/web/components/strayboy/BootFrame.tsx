"use client";

import { useEffect, useState } from "react";

/**
 * 切屏演出（motion.md §4：旧屏熄灭 2 帧黑场 → 新屏点亮 f8）。
 * 挂在子屏/页面顶部：mount 时黑场覆盖，steps 点亮后移除。
 */
export function BootFrame() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setDone(true), 260);
    return () => clearTimeout(id);
  }, []);
  if (done) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[60] bg-black"
      style={{ animation: "sb-boot 0.26s steps(8) forwards" }}
    />
  );
}
