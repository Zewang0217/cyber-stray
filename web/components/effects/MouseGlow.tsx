"use client";

import { useEffect, useState } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";

/**
 * 跟随鼠标的柔和光晕
 * 使用 spring 物理动画实现丝滑跟踪
 */
export function MouseGlow(): React.ReactElement {
  const [isMounted, setIsMounted] = useState(false);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const springConfig = { stiffness: 400, damping: 25 };
  const smoothX = useSpring(mouseX, springConfig);
  const smoothY = useSpring(mouseY, springConfig);

  useEffect(() => {
    setIsMounted(true);

    const handleMouseMove = (e: MouseEvent): void => {
      mouseX.set(e.clientX);
      mouseY.set(e.clientY);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [mouseX, mouseY]);

  if (!isMounted) return <></>;

  return (
    <motion.div
      className="fixed pointer-events-none z-[1]"
      style={{
        x: smoothX,
        y: smoothY,
        translateX: "-50%",
        translateY: "-50%",
      }}
    >
      <div
        className="w-[500px] h-[500px] rounded-full blur-3xl"
        style={{
          background: `radial-gradient(circle, var(--c-glow) 0%, transparent 70%)`,
          opacity: "var(--c-glow-opacity)",
        }}
      />
    </motion.div>
  );
}
