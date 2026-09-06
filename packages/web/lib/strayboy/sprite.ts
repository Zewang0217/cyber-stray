/**
 * PetSprite 帧表契约（stray-boy.sprite.v2）的解析与播放样式生成。
 *
 * 为什么独立成纯函数库：播放器是零运行时 CSS steps()（motion.md §3/§5），
 * 帧表 → keyframes 的换算是唯一逻辑，收在这里做单测；组件只渲染。
 * 资产由 scripts/sprite/build_sprite.py 确定性产出（#169 帧表 v2）。
 */

export interface SpriteAnimation {
  from: number;
  frames: number;
  duration: number;
  loop: boolean;
}

export interface SpriteContract {
  contract: string;
  image: string;
  frame: { w: number; h: number; groundRow: number };
  animations: Record<string, SpriteAnimation>;
  overlays: { hungry: { image: string; frames: number; duration: number } };
  palette: Record<string, string>;
  provenance: Record<string, string>;
}

/** 解析并硬校验帧表（不合法即抛错，禁兜底——坏契约必须炸在接线处）。 */
export function parseSpriteContract(raw: unknown): SpriteContract {
  const c = raw as SpriteContract;
  if (c.contract !== "stray-boy.sprite.v2") {
    throw new Error(`未知 sprite 契约: ${String(c.contract)}`);
  }
  if (!c.frame || c.frame.w <= 0 || c.frame.h <= 0) {
    throw new Error("sprite 帧尺寸非法");
  }
  const anims = Object.entries(c.animations ?? {});
  if (anims.length === 0) {
    throw new Error("sprite 帧表无动画");
  }
  let total = 0;
  for (const [name, a] of anims) {
    if (!(a.frames > 0) || !(a.duration > 0)) {
      throw new Error(`动画 ${name} 帧数/时长非法`);
    }
    if (a.from !== total) {
      throw new Error(`动画 ${name} from=${a.from} 不连续（期望 ${total}）`);
    }
    total += a.frames;
  }
  if (!c.overlays?.hungry?.frames) {
    throw new Error("缺 hungry 眼睛叠加层契约");
  }
  return c;
}

/** 稳定的 keyframes 命名空间（同契约多实例共用一份 <style>）。 */
export function contractId(contract: SpriteContract): string {
  return contract.image.replace(/[^a-z0-9]/gi, "");
}

/** 生成契约的全部 keyframes（含 hungry 叠加层）；一次注入，全页复用。 */
export function animationCss(contract: SpriteContract): string {
  const id = contractId(contract);
  const rules: string[] = [];
  for (const [name, a] of Object.entries(contract.animations)) {
    rules.push(
      `@keyframes sbp-${id}-${name}{from{background-position:calc(var(--sbp-step) * ${-a.from}) 0}` +
        `to{background-position:calc(var(--sbp-step) * ${-(a.from + a.frames)}) 0}}`,
    );
  }
  // 饥饿眼神：70% 闭眼（下垂）+ 30% 睁眼 peek——f1=闭、f2=睁（build_sprite.py 帧序）
  const hungry = contract.overlays.hungry;
  rules.push(
    `@keyframes sbp-${id}-hungry{0%,69%{background-position:0 0}` +
      `70%,100%{background-position:calc(var(--sbp-step) * ${-(hungry.frames - 1)}) 0}}`,
  );
  rules.push(
    `@media (prefers-reduced-motion:reduce){.sbp-${id}{animation:none!important}}`,
  );
  return rules.join("");
}

export interface FrameStyleInput {
  contract: SpriteContract;
  anim: string;
  /** 显示边长（像素，32 的整数倍缩放；必须 integer 保像素纯度） */
  scale: number;
  hungry?: boolean;
}

/** 单实例的播放样式：动画 + 首帧位置（reduced-motion 停帧即落在这里）。 */
export function frameStyle({ contract, anim, scale, hungry }: FrameStyleInput): React.CSSProperties {
  if (!hungry && !contract.animations[anim]) {
    throw new Error(`未知动画: ${anim}（帧表中不存在）`);
  }
  const id = contractId(contract);
  const { w, h } = contract.frame;
  const total = Object.values(contract.animations).reduce((sum, a) => sum + a.frames, 0);
  const a = contract.animations[anim];
  return {
    display: "block",
    width: w * scale,
    height: h * scale,
    "--sbp-step": `${w * scale}px`,
    backgroundImage: `url(/pet/strayboy/${contract.image})`,
    backgroundSize: `${total * w * scale}px ${h * scale}px`,
    backgroundPosition: `calc(var(--sbp-step) * ${-(a?.from ?? 0)}) 0`,
    animation: `sbp-${id}-${anim} ${a.duration}s steps(${a.frames}) ${a.loop ? "infinite" : "forwards"}`,
  } as React.CSSProperties;
}

/** 饥饿眼睛叠加层样式（挂在 .eyes 元素上，1.2s steps(2) 同频闪烁）。 */
export function hungryStyle(contract: SpriteContract, scale: number): React.CSSProperties {
  const id = contractId(contract);
  const { w, h } = contract.frame;
  const hungry = contract.overlays.hungry;
  return {
    display: "block",
    width: w * scale,
    height: h * scale,
    "--sbp-step": `${w * scale}px`,
    backgroundImage: `url(/pet/strayboy/${hungry.image})`,
    backgroundSize: `${hungry.frames * w * scale}px ${h * scale}px`,
    animation: `sbp-${id}-hungry ${hungry.duration}s steps(${hungry.frames}) infinite`,
  } as React.CSSProperties;
}
