/**
 * 宠物精灵图 manifest(素材契约)
 *
 * 素材来自 AI 生图管线(scripts/pet-sheet.py):参考图锁定角色 → 3x3 网格
 * → 每状态一条横排帧条 PNG(public/pet/<state>.png,256px 方帧,透明底)。
 * 重生成素材:改提示词 → qwen-image 出图 → python3 scripts/pet-sheet.py <raw> --grid --states <...> --out public/pet
 * 帧数/时长改了才需要动这里。
 *
 * #94：状态注册表（PET_STATES/PetState/PetStateSpec）上移到
 * @cyber-stray/shared/pet 单一真相源——自定义 IP 生成管线（control-plane）
 * 与内置素材播放共用同一份契约；此处仅保留心情推导。
 */

import {
  PET_STATES,
  type PetStateSpec,
  type PetStateId,
} from '@cyber-stray/shared/pet';

export type PetState = PetStateId;
export type { PetStateSpec };

export { PET_STATES };

/** 心情 → 展示状态(宠物状态机制映射到可见动画) */
export function stateForMood(
  mood: "curious" | "grumpy" | "playful" | "lazy" | "excited" | "emo",
): PetState {
  if (mood === "playful" || mood === "excited") return "joy";
  if (mood === "grumpy" || mood === "emo") return "grumpy";
  if (mood === "lazy") return "sleep";
  return "idle";
}
