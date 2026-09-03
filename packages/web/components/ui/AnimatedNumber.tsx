"use client";

import { animate, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

/**
 * AnimatedNumber - 采集者重新清点
 *
 * 数字从 0 计到现值(0.9s expo ease-out),像采集者把标本数重数一遍。
 * 值变化(刷新/修订)才重放;未变不重挂载。prefers-reduced-motion 直接落值。
 * 与 RevisingValue 分工:读数行用修订闪光,大统计用清点计数,不叠加。
 */
export function AnimatedNumber({
  value,
  duration = 0.9,
}: {
  value: number;
  duration?: number;
}): React.ReactElement {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(reduced ? value : 0);

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      return;
    }
    const controls = animate(0, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [value, duration, reduced]);

  return <>{display}</>;
}
