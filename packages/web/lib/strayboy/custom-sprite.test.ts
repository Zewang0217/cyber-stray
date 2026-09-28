import { describe, expect, it, vi } from "vitest";
import { spriteContractFromManifest, streetAnimFor } from "./custom-sprite";
import type { PetAssetManifest } from "@cyber-stray/shared/pet";

/**
 * 领养自定义精灵图桥接测试：manifest.sprite → SpriteContract 装配 +
 * 必需动画校验（缺动画整体回退）+ 街角演出动画映射降级。
 */

/** CP finalizeSheet 写出的 sprite 块形状（6 动画 16 帧 64px） */
function manifestWith(overrides: Partial<PetAssetManifest["sprite"]> = {}): PetAssetManifest {
  return {
    version: 2,
    generatedAt: "2026-09-28T00:00:00.000Z",
    states: {},
    sprite: {
      image: "sprite.png",
      frame: { w: 64, h: 64, groundRow: 63 },
      animations: {
        idle: { from: 0, frames: 4, duration: 0.8, loop: true },
        walk: { from: 4, frames: 2, duration: 0.6, loop: true },
        sleep: { from: 6, frames: 2, duration: 1.6, loop: true },
        grumpy: { from: 8, frames: 2, duration: 1.2, loop: true },
        joy: { from: 10, frames: 2, duration: 0.4, loop: true },
        welcome: { from: 12, frames: 2, duration: 0.8, loop: true },
        think: { from: 14, frames: 2, duration: 0.8, loop: true },
      },
      ...overrides,
    },
  };
}

describe("spriteContractFromManifest", () => {
  it("合法 sprite 块 → 可播契约（16 帧横排）", () => {
    const c = spriteContractFromManifest(manifestWith());
    expect(c).not.toBeNull();
    expect(c?.image).toBe("sprite.png");
    expect(c?.frame).toEqual({ w: 64, h: 64, groundRow: 63 });
    expect(c?.overlays).toBeUndefined();
    const total = Object.values(c?.animations ?? {}).reduce((s, a) => s + a.frames, 0);
    expect(total).toBe(16);
  });

  it("无 sprite 块（改造屋 quad 路径 manifest）→ null", () => {
    const m = manifestWith();
    delete m.sprite;
    expect(spriteContractFromManifest(m)).toBeNull();
  });

  it("帧表畸形（from 不连续）→ null 回退而非抛错（与缺动画同失败域，不炸街角）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = manifestWith();
    (m.sprite as { animations: Record<string, unknown> }).animations.walk = {
      from: 99, frames: 4, duration: 0.6, loop: true,
    };
    expect(spriteContractFromManifest(m)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("畸形"), expect.anything());
    warn.mockRestore();
  });

  it("缺必需动画（素材版本不符）→ null 且 warn，不播半套", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = manifestWith();
    delete (m.sprite as { animations: Record<string, unknown> }).animations.welcome;
    expect(spriteContractFromManifest(m)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("welcome"));
    warn.mockRestore();
  });
});

describe("streetAnimFor（精灵图集不含的街角演出动画映射降级）", () => {
  it("pat/celebrate/eat/pounce 映射到最接近的已生成动画", () => {
    expect(streetAnimFor("pat")).toBe("joy");
    expect(streetAnimFor("celebrate")).toBe("joy");
    expect(streetAnimFor("eat")).toBe("idle");
    expect(streetAnimFor("pounce")).toBe("joy");
  });

  it("已生成动画（含 think 真实化后）原样透传", () => {
    for (const a of ["idle", "walk", "sleep", "grumpy", "joy", "welcome", "think"]) {
      expect(streetAnimFor(a)).toBe(a);
    }
  });
});
