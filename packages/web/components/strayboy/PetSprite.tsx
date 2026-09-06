import { animationCss, frameStyle, hungryStyle } from "@/lib/strayboy/sprite";
import type { SpriteContract } from "@/lib/strayboy/sprite";

/**
 * PetSprite 播放器（motion.md §3 契约）：spritesheet + frames.json + 纯 CSS steps()，
 * 零 JS 运行时动画。data-anim/data-hungry 属性即状态机接线面
 * （街角票由 SSE 状态流驱动切换）。契约级 keyframes 随实例注入 <style>（等价
 * CSS 多份无害）。纯渲染组件，可在服务端或客户端使用。
 */
export function PetSprite({
  contract,
  anim,
  scale = 3,
  hungry = false,
  className,
}: {
  contract: SpriteContract;
  anim: string;
  scale?: number;
  hungry?: boolean;
  className?: string;
}) {
  return (
    <div
      className={className}
      data-anim={anim}
      data-hungry={hungry ? "true" : "false"}
      style={{ position: "relative", lineHeight: 0 }}
    >
      <style dangerouslySetInnerHTML={{ __html: animationCss(contract) }} />
      <span className="pixelated" style={frameStyle({ contract, anim, scale })} />
      {hungry && (
        <span
          aria-hidden
          className="pixelated"
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
