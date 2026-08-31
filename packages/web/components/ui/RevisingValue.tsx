"use client";

import { useState } from "react";

/**
 * 修订值(采集者擦改笔记)
 * 只在「值变化」时触发琥珀墨修订闪光;首屏不闪(避免进场即一片闪烁)。
 * 原理:渲染期派生 state(React 官方 pattern)——值变化 → key 换新 + 挂上
 * revise-flash 类 → 新 span 挂载即重放动画;未变 → 无 state 更新、无重挂载。
 * prefers-reduced-motion 由 globals.css 的全局收敛规则兜底。
 */
export function RevisingValue({ value }: { value: string | number }): React.ReactElement {
  const [state, setState] = useState<{ v: string; changed: boolean }>({
    v: String(value),
    changed: false,
  });
  const v = String(value);
  if (state.v !== v) {
    // 渲染期调整 state:只在实际变化时触发一次重渲(官方 derived-state 模式)
    setState({ v, changed: true });
  }
  return (
    <span key={v} className={state.changed ? "revise-flash" : ""}>
      {value}
    </span>
  );
}
