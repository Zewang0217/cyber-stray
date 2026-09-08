/**
 * 街角视图状态机（纯函数）：CP 数据 → 掌机演出参数。
 * 为什么独立：状态→动画/墨条的映射是街角的全部逻辑，纯函数可表驱动测试；
 * 页面只做 SSE→输入的接线。
 */
import { isSleeping } from "@/lib/sleep";
import type { AgentState, Mood } from "@/lib/types";

export interface PetRecord {
  name: string;
  createdAt: number;
  sleepStart: number | null;
  sleepEnd: number | null;
  personality?: string;
  catchphrases?: Array<{ text: string }>;
}

/** 精力低于该值 → 饿演出（眼睛叠加 + 告警墨条色）；演出层保留，HUD 文案不再出现「饥饿」。 */
export const HUNGRY_ENERGY_THRESHOLD = 20;

export interface StreetView {
  anim: "idle" | "walk" | "joy" | "sleep" | "grumpy";
  /** 猫是否出屏（游荡进行中，街角显示「溜达中」牌） */
  away: boolean;
  hungry: boolean;
  sleeping: boolean;
  /** #218 数值联动（ADR-0013 注入值为真相源；null 不联动）：
   * 无聊 ≥ 80 的 grumpy 常态演出（失败态是瞬时覆盖，见 StreetCorner） */
  bored: boolean;
  /** 精力 ≤ 25 的非睡眠期打盹演出（复用 sleep 帧 + 街角 zZ 角标区分 #91 睡眠期） */
  napping: boolean;
  /**
   * HUD 三墨条 = 后端原始值（ADR-0013 §4：精力/无聊/脾气，0-100，精力高=好）。
   * state 缺失 → null（HUD 显未知态「--」）；禁伪装健康兜底（#214 审计 B 类：
   * 旧版 null 时填 energy=100/boredom=0 伪装最健康）。
   */
  bars: { energy: number | null; boredom: number | null; temper: number | null };
  /** 心情 = 后端枚举原文（curious/playful/excited/lazy/grumpy/emo）；缺失 → null。
   * 不做分数换算（#217：旧 moodScore 三档映射是前端发明） */
  mood: Mood | null;
  /** LV = totalWanders ÷ 10 向下取整（spec Decision 6，state 无 level 字段） */
  level: number;
  /** DAY N：领养日起的自然日数 */
  day: number;
}

export function deriveStreetView(
  state: AgentState | null,
  pet: PetRecord,
  now: Date,
  wandering: boolean,
): StreetView {
  const energy = state?.energy ?? null;
  const boredom = state?.boredom ?? null;
  const temper = state?.temper ?? null;
  const sleeping = isSleeping(now.getHours(), pet.sleepStart, pet.sleepEnd);
  // state 缺失 = 未知，不触发饿演出（拿 null 冒充健康/饥饿都是编造）
  const hungry = energy !== null && energy < HUNGRY_ENERGY_THRESHOLD;
  // #218 数值常态演出：优先级 游荡 > 睡眠 > 打盹 > 无聊 grumpy > idle；
  // 连续失败不再入 baseline——它移到 StreetCorner 作瞬时覆盖（票面：失败态是瞬时的）
  const BORED_GRUMPY_THRESHOLD = 80;
  const NAP_ENERGY_THRESHOLD = 25;
  const bored = boredom !== null && boredom >= BORED_GRUMPY_THRESHOLD;
  const napping = !sleeping && energy !== null && energy <= NAP_ENERGY_THRESHOLD;
  const anim: StreetView["anim"] = wandering
    ? "walk"
    : sleeping
      ? "sleep"
      : napping
        ? "sleep"
        : bored
          ? "grumpy"
          : "idle";
  const day = Math.max(
    1,
    Math.floor((now.getTime() - pet.createdAt) / 86_400_000) + 1,
  );
  return {
    anim,
    away: wandering,
    hungry,
    sleeping,
    bars: { energy, boredom, temper },
    mood: state?.mood ?? null,
    bored,
    napping,
    level: Math.floor((state?.totalWanders ?? 0) / 10),
    day,
  };
}
