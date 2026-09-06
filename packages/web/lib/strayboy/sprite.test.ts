import { parseSpriteContract, animationCss, frameStyle, hungryStyle } from "./sprite";
import type { SpriteContract } from "./sprite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 帧表契约测试：fixture 即真实产物（public/pet/strayboy/frames.json，由
 * scripts/sprite/build_sprite.py 确定性生成）。只断言外部行为——契约值、
 * 换算产物（keyframes/样式），不测内部实现。
 */

function loadContract(): SpriteContract {
  const raw = readFileSync(
    join(process.cwd(), "public/pet/strayboy/frames.json"),
    "utf8",
  );
  return parseSpriteContract(JSON.parse(raw));
}

describe("stray-boy.sprite.v2 契约", () => {
  const contract = loadContract();

  it("帧表与 motion.md §3.5 定稿一致", () => {
    expect(contract.frame).toEqual({ w: 32, h: 32, groundRow: 30 });
    expect(contract.animations.idle).toEqual({ from: 0, frames: 4, duration: 0.8, loop: true });
    expect(contract.animations.walk).toEqual({ from: 4, frames: 4, duration: 0.6, loop: true });
    expect(contract.animations.joy).toEqual({ from: 8, frames: 2, duration: 0.4, loop: true });
    expect(contract.animations.sleep).toEqual({ from: 12, frames: 2, duration: 1.6, loop: true });
    expect(contract.animations.pat).toEqual({ from: 22, frames: 2, duration: 0.4, loop: false });
    expect(contract.animations.pounce).toEqual({ from: 24, frames: 2, duration: 0.4, loop: false });
    expect(contract.overlays.hungry).toEqual({ image: "eyes.png", frames: 2, duration: 1.2 });
  });

  it("坏契约显式抛错（禁兜底）", () => {
    const bad = { ...contract, animations: { fly: { from: 5, frames: 2, duration: 0.4, loop: true } } };
    expect(() => parseSpriteContract({ ...bad, frame: { w: 32.5, h: 32, groundRow: 30 } })).toThrow(/帧尺寸/);
    expect(() => parseSpriteContract(bad)).toThrow(/动画 fly from/);
  });

  it("globals 携带 sprite 的 reduced-motion 停帧规则（组件按 sbp- 类命中）", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*\[class\*=\"sbp-\"\]/);
  });

  it("全部 11 动作合计 26 帧", () => {
    const total = Object.values(contract.animations).reduce((s, a) => s + a.frames, 0);
    expect(total).toBe(26);
  });

  it("sheet 体积 ≤8KB（motion.md §5 预算）", () => {
    const size = readFileSync(
      join(process.cwd(), "public/pet/strayboy/cat.png"),
    ).byteLength;
    expect(size).toBeLessThanOrEqual(8192);
  });
});

describe("播放换算", () => {
  const contract = loadContract();

  it("keyframes 帧边界：loop 回绕下一首帧，forwards 定格本动画最后一帧", () => {
    const css = animationCss(contract);
    for (const [name, a] of Object.entries(contract.animations)) {
      expect(css).toContain(
        `sbp-catpng-${name}{from{background-position:calc(var(--sbp-step) * ${-a.from}) 0}`,
      );
      const to = a.loop ? -(a.from + a.frames) : -(a.from + a.frames - 1);
      expect(css).toContain(
        `to{background-position:calc(var(--sbp-step) * ${to}) 0}}`,
      );
    }
    expect(css).toContain("sbp-catpng-hungry{0%,69%{background-position:0 0}");
  });

  it("frameStyle：backgroundSize = 总帧 × 帧宽 × scale，位置落在首帧", () => {
    const style = frameStyle({ contract, anim: "walk", scale: 4 });
    expect(style.width).toBe(128);
    expect(style.backgroundSize).toBe(`${26 * 32 * 4}px 128px`);
    expect((style as Record<string, string>)["--sbp-step"]).toBe("128px");
    expect(style.backgroundPosition).toBe("calc(var(--sbp-step) * -4) 0");
    expect(style.animation).toContain("steps(4)");
    expect(style.animation).toContain("infinite");
  });

  it("frameStyle：forwards 动画（pat）不循环", () => {
    const style = frameStyle({ contract, anim: "pat", scale: 2 });
    expect(style.animation).toContain("forwards");
    expect(style.animation).not.toContain("infinite");
  });

  it("未知动画抛错（禁兜底）", () => {
    expect(() => frameStyle({ contract, anim: "fly", scale: 2 })).toThrow(/未知动画/);
  });

  it("hungryStyle：叠加层走独立 sheet 与 1.2s steps(2)", () => {
    const style = hungryStyle(contract, 2);
    expect(style.backgroundImage).toContain("eyes.png");
    expect(style.backgroundSize).toBe(`${2 * 32 * 2}px 64px`);
    expect(style.animation).toContain("1.2s steps(2)");
  });
});
