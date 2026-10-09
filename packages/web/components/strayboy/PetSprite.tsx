"use client";

import { useEffect } from "react";
import { animationCss, contractId, frameStyle, hungryStyle } from "@cyber-stray/shared/sprite";
import type { SpriteContract } from "@cyber-stray/shared/sprite";

/**
 * 契约级 <style> 去重：挂 document.head（每契约一次，跨组件卸载存活）。
 * 不能内联渲染——内联 style 随组件卸载被移除，而本 Map 阻止重注入，
 * 任何 tab 往返/游荡回归后猫会冻成雕像（PR #236 评审 C-B1）。
 * Map 值 = 已注入的 css：同 id 契约内容变化（领养精灵图重生成换帧表）
 * 时原地改写，避免陈旧 keyframes。
 */
const injected = new Map<string, string>();

/**
 * PetSprite 播放器（motion.md §3 契约）：spritesheet + frames.json + 纯 CSS steps()，
 * 零 JS 运行时动画。data-anim/data-hungry 属性即状态机接线面
 * （街角票由 SSE 状态流驱动切换）。keyframes 经 effect 挂 document.head
 * （跨卸载存活，PR #236 评审 C-B1），SSR 首帧为静帧、hydration 后起播。
 * 两个 span 都挂 sbp-<id> 类——reduced-motion 停帧规则（sprite.ts）按它命中。
 */
export function PetSprite({
  contract,
  anim,
  scale = 3,
  hungry = false,
  basePath,
  className,
}: {
  contract: SpriteContract;
  anim: string;
  scale?: number;
  hungry?: boolean;
  /** 精灵图资产根（缺省内置 /pet/strayboy；领养自定义传 /api/pet-assets） */
  basePath?: string;
  className?: string;
}) {
  const id = contractId(contract);
  useEffect(() => {
    const css = animationCss(contract);
    if (injected.get(id) === css) return;
    const existing = document.head.querySelector<HTMLStyleElement>(`style[data-sbp-contract="${id}"]`);
    if (existing) {
      existing.innerHTML = css;
    } else {
      const style = document.createElement("style");
      style.dataset.sbpContract = id;
      style.innerHTML = css;
      document.head.appendChild(style);
    }
    injected.set(id, css);
  }, [id, contract]);
  return (
    <div
      className={className}
      data-anim={anim}
      data-hungry={hungry ? "true" : "false"}
      style={{ position: "relative", lineHeight: 0 }}
    >
      <span className={`pixelated sbp-${id}`} style={{ ...frameStyle({ contract, anim, scale, basePath }) }} />
      {hungry && contract.overlays && (
        <span
          aria-hidden
          className={`pixelated sbp-${id}`}
          style={{
            ...hungryStyle(contract, scale),
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
