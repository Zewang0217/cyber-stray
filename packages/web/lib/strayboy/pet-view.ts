/**
 * 街角视图状态机（纯函数）：CP 数据 → 掌机演出参数。
 * 为什么独立：状态→动画/墨条的映射是街角的全部逻辑，纯函数可表驱动测试；
 * 页面只做 SSE→输入的接线。
 */
import { isSleeping } from "@cyber-stray/shared/sleep";
import type { AgentStateSnapshot } from "@cyber-stray/shared/agent-state";
import type { PetMood } from "@cyber-stray/shared/pet-stats";

export interface PetRecord {
  name: string;
  createdAt: number;
  sleepStart: number | null;
  sleepEnd: number | null;
  personality?: string;
  catchphrases?: Array<{ text: string }>;
  /** 每日 LLM 预算耗尽停派（CP pets GET 下发；SSE 转变沿由街角本地合并） */
  budgetPaused?: boolean;
}

/** 精力低于该值 → 饿演出（眼睛叠加 + 告警墨条色）；演出层保留，HUD 文案不再出现「饥饿」。 */
export const HUNGRY_ENERGY_THRESHOLD = 20;

export interface StreetView {
  anim: "idle" | "walk" | "joy" | "sleep" | "grumpy";
  /** 猫是否出屏（游荡进行中，街角显示「溜达中」牌） */
  away: boolean;
  hungry: boolean;
  sleeping: boolean;
  /** 数值联动（注入值为真相源；null 不联动）：无聊 ≥ 80 的 grumpy 常态演出
   * （失败态是瞬时覆盖，见 StreetCorner） */
  bored: boolean;
  /** 精力 ≤ 25 的非睡眠期打盹演出（复用 sleep 帧 + 街角 zZ 角标与作息睡眠期区分） */
  napping: boolean;
  /**
   * HUD 三墨条 = 后端原始值（精力/无聊/脾气，0-100，精力高=好）。
   * state 缺失 → null（HUD 显未知态「--」）；禁伪装健康兜底——
   * null 时填 energy=100/boredom=0 是在拿假数据冒充最健康。
   */
  bars: { energy: number | null; boredom: number | null; temper: number | null };
  /** 心情 = 后端枚举原文（curious/playful/excited/lazy/grumpy/emo）；缺失 → null。
   * 不做分数换算（前端不发明映射） */
  mood: PetMood | null;
  /** LV = totalWanders ÷ 10 向下取整（state 无 level 字段） */
  level: number;
  /** DAY N：领养日起的自然日数 */
  day: number;
}

export function deriveStreetView(
  state: AgentStateSnapshot | null,
  pet: PetRecord,
  now: Date,
  wandering: boolean,
): StreetView {
  const energy = state?.energy ?? null;
  const boredom = state?.boredom ?? null;
  const temper = state?.temper ?? null;
  // 预算耗尽 = 租户侧「宠物在睡觉」，共用睡眠演出（夜幕 + sleep 帧 +
  // 拍睡台词），不造第二种睡觉视觉；作息睡眠同样源于「这轮不出门」
  const sleeping = isSleeping(now.getHours(), pet.sleepStart, pet.sleepEnd) || pet.budgetPaused === true;
  // state 缺失 = 未知，不触发饿演出（拿 null 冒充健康/饥饿都是编造）
  const hungry = energy !== null && energy < HUNGRY_ENERGY_THRESHOLD;
  // 数值常态演出优先级：游荡 > 睡眠 > 打盹 > 无聊 grumpy > idle；
  // 连续失败不入 baseline——它是瞬时覆盖（见 StreetCorner）
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
