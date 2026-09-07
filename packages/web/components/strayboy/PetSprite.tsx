import { animationCss, contractId, frameStyle, hungryStyle } from "@/lib/strayboy/sprite";
import type { SpriteContract } from "@/lib/strayboy/sprite";

/** 契约级 <style> 去重：每进程每契约只注入一次（RSC/客户端模块作用域各自成立）。 */
const injected = new Set<string>();

/**
 * PetSprite 播放器（motion.md §3 契约）：spritesheet + frames.json + 纯 CSS steps()，
 * 零 JS 运行时动画。data-anim/data-hungry 属性即状态机接线面
 * （街角票由 SSE 状态流驱动切换）。纯渲染组件，可在服务端或客户端使用。
 * 两个 span 都挂 sbp-<id> 类——reduced-motion 停帧规则（sprite.ts）按它命中。
 */
export function PetSprite({
  contract,
  anim,
  scale = 3,
  hungry = false,
  coat = "orange",
  className,
}: {
  contract: SpriteContract;
  anim: string;
  scale?: number;
  hungry?: boolean;
  /** 毛色皮肤滤镜（delight B12，DESIGN.md §7 图鉴皮肤） */
  coat?: "orange" | "black" | "calico";
  className?: string;
}) {
  const coatFilterCss = coat === "black" ? "brightness(0.25) saturate(0.3)"
    : coat === "calico" ? "hue-rotate(-40deg) saturate(1.2)" : "none";
  const id = contractId(contract);
  const inject = !injected.has(id);
  injected.add(id);
  return (
    <div
      className={className}
      data-anim={anim}
      data-hungry={hungry ? "true" : "false"}
      style={{ position: "relative", lineHeight: 0 }}
    >
      {inject && <style dangerouslySetInnerHTML={{ __html: animationCss(contract) }} />}
      <span className={`pixelated sbp-${id}`} style={{ ...frameStyle({ contract, anim, scale }), filter: coatFilterCss }} />
      {hungry && (
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
