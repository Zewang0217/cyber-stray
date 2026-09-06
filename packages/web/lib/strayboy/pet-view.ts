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
}

/** 精力低于该值 → 饥饿演出（眼睛叠加 + 告警墨条色）。 */
export const HUNGRY_ENERGY_THRESHOLD = 20;

export interface StreetView {
  anim: "idle" | "walk" | "joy" | "sleep" | "grumpy";
  /** 猫是否出屏（游荡进行中，街角显示「溜达中」牌） */
  away: boolean;
  hungry: boolean;
  sleeping: boolean;
  /** HUD 三墨条：饥饿(↔精力反向)/无聊/心情(↔脾气反向)，0-100 */
  bars: { hunger: number; boredom: number; mood: number };
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
  const energy = state?.energy ?? 100;
  const boredom = state?.boredom ?? 0;
  const temper = state?.temper ?? 0;
  // 心情→分值：Mood 联合（curious/playful/excited 偏正，lazy 居中，grumpy/emo 偏负）
  const POSITIVE_MOODS: Mood[] = ["curious", "playful", "excited"];
  const moodScore = state ? (POSITIVE_MOODS.includes(state.mood) ? 80 : state.mood === "lazy" ? 55 : 20) : 80;
  const sleeping = isSleeping(now.getHours(), pet.sleepStart, pet.sleepEnd);
  const hungry = energy < HUNGRY_ENERGY_THRESHOLD;
  const anim: StreetView["anim"] = wandering
    ? "walk"
    : sleeping
      ? "sleep"
      : state?.consecutiveFailures != null && state.consecutiveFailures >= 3
        ? "grumpy"
        : "idle";
  const day = Math.max(
    1,
    Math.floor((now.getTime() - pet.createdAt) / 86_400_000) + 1,
  );
  return {
    anim,
    away: wandering && !sleeping,
    hungry,
    sleeping,
    bars: {
      hunger: 100 - energy,
      boredom,
      mood: Math.max(0, moodScore - temper / 2),
    },
    level: Math.floor((state?.totalWanders ?? 0) / 10),
    day,
  };
}
