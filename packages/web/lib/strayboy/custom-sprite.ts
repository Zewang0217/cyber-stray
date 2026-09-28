/**
 * 领养自定义精灵图（manifest.sprite 块）→ 播放契约的桥接（纯函数）。
 *
 * CP petgen sheet 管线 finalize 写出的 manifest 带 sprite 块（横排总条 +
 * 帧表，frames.json 同构）；本模块把它装配成 PetSprite 可播的 SpriteContract，
 * 并处理街角演出动画集（pat/think 等未生成动画）到已生成动画的映射降级。
 * 为什么放 web/lib：消费侧装配逻辑，CP 已在 finalize 把帧表写死（契约单一
 * 拥有者），这里只读装配、不重新定义帧序。
 */
import { parseSpriteContract, type SpriteContract } from "@cyber-stray/shared/sprite";
import { PET_SHEET_STATE_IDS, type PetAssetManifest } from "@cyber-stray/shared/pet";

/** 自定义精灵图必须齐备的动画（= shared 精灵图动画集，非本地镜像；
 * 缺任何一个 = 资产版本不受支持 → 回退内置猫（与 manifest 404 同语义） */
const REQUIRED_ANIMS: ReadonlyArray<string> = PET_SHEET_STATE_IDS;

/** 街角演出动画 → 精灵图动画（4×4 集不含的动画映射到最接近的已生成动画：
 * 拍拍/庆祝/扑跳 → joy 的跳动，思考/进食 → idle 的静态微动） */
const ANIM_FALLBACK: Record<string, string> = {
  pat: "joy",
  celebrate: "joy",
  eat: "idle",
  pounce: "joy",
};

/** 街角演出动画 → 自定义精灵图可播动画（未生成动画映射降级；已生成原样） */
export function streetAnimFor(anim: string): string {
  return ANIM_FALLBACK[anim] ?? anim;
}

/** 自定义精灵图资产根（web rewrite 代理 CP /api/pet-assets，session 鉴权） */
export const CUSTOM_SPRITE_BASE_PATH = "/api/pet-assets";

/**
 * manifest.sprite → SpriteContract；无 sprite 块或资产不受支持（缺必需动画 /
 * 帧表畸形）→ null（调用方回退内置猫）。契约形状与 stray-boy.sprite.v2 同构
 * （横排帧条 + steps() 帧表），仅无 hungry 叠加层/色板元数据。
 * 帧表畸形与缺动画同属「资产版本不受支持」的失败域——回退而非炸街角。
 */
export function spriteContractFromManifest(
  manifest: PetAssetManifest,
): SpriteContract | null {
  const sprite = manifest.sprite;
  if (!sprite) return null;
  const missing = REQUIRED_ANIMS.filter((a) => !(a in sprite.animations));
  if (missing.length > 0) {
    // 素材版本缺动画：不播半套（帧表 from 偏移会错位），整体回退内置猫
    console.warn(`[custom-sprite] 素材缺动画 ${missing.join(",")}，回退内置猫`);
    return null;
  }
  try {
    return parseSpriteContract({
      contract: "stray-boy.sprite.v2",
      image: sprite.image,
      frame: sprite.frame,
      animations: sprite.animations,
    });
  } catch (error) {
    console.warn("[custom-sprite] 素材帧表畸形，回退内置猫：", error);
    return null;
  }
}
