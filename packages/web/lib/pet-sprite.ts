/**
 * 宠物精灵图 manifest(素材契约)
 *
 * 素材来自 AI 生图管线(scripts/pet-sheet.py):参考图锁定角色 → 3x3 网格
 * → 每状态一条横排帧条 PNG(public/pet/<state>.png,256px 方帧,透明底)。
 * 重生成素材:改提示词 → qwen-image 出图 → python3 scripts/pet-sheet.py <raw> --grid --states <...> --out public/pet
 * 帧数/时长改了才需要动这里。
 */

export type PetState =
  | "idle"
  | "walk"
  | "joy"
  | "eat"
  | "sleep"
  | "think"
  | "celebrate"
  | "grumpy"
  | "welcome";

export interface PetStateSpec {
  /** 帧条文件名(不含扩展名) */
  file: string;
  /** 帧数(必须与 PNG 实际帧数一致,否则播放跳帧) */
  frames: number;
  /** 一次完整循环时长(秒);呼吸慢,动作快 */
  dur: number;
  /** 无障碍描述 */
  label: string;
}

export const PET_STATES: Record<PetState, PetStateSpec> = {
  idle: { file: "idle", frames: 3, dur: 1.6, label: "待机呼吸" },
  walk: { file: "walk", frames: 3, dur: 0.8, label: "游荡" },
  joy: { file: "joy", frames: 3, dur: 0.7, label: "开心" },
  eat: { file: "eat", frames: 3, dur: 0.9, label: "进食" },
  sleep: { file: "sleep", frames: 3, dur: 2.2, label: "休息" },
  think: { file: "think", frames: 3, dur: 1.4, label: "思考" },
  celebrate: { file: "celebrate", frames: 3, dur: 0.65, label: "庆祝" },
  grumpy: { file: "grumpy", frames: 3, dur: 1.1, label: "不爽" },
  welcome: { file: "welcome", frames: 3, dur: 0.8, label: "打招呼" },
};

/** 心情 → 展示状态(宠物状态机制映射到可见动画) */
export function stateForMood(
  mood: "curious" | "grumpy" | "playful" | "lazy" | "excited" | "emo",
): PetState {
  if (mood === "playful" || mood === "excited") return "joy";
  if (mood === "grumpy" || mood === "emo") return "grumpy";
  if (mood === "lazy") return "sleep";
  return "idle";
}
