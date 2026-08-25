/**
 * 无聊/精力时间前推（S5）
 *
 * 纯函数：编排状态 time-propagable——不常驻进程，读宠物行 + 当前时刻即可
 * 推出此刻的无聊/精力（无聊随时间上升，精力随时间恢复），夹取 0-100。
 * 前推值是瞬时视图；SQLite 只在游荡写回时落盘（避免每 tick 写库）。
 */

export const MINUTE_MS = 60_000;

import { getPersonality, type PersonalityId } from '@cyber-stray/shared';

/** 前推速率（每分钟） */
export interface PropagationRates {
  /** 无聊上升/分钟 */
  boredomPerMinute: number;
  /** 精力恢复/分钟 */
  energyPerMinute: number;
}

/** 前推所需的宠物列（pets.$inferSelect 子集，便于测试构造） */
export interface PropagatablePet {
  lastRunAt: number | null;
  /** null lastRunAt 时的前推起点（createdAt） */
  createdAt: number;
  boredom: number;
  energy: number;
}

/** 前推后的瞬时状态 */
export interface PropagatedState {
  boredom: number;
  energy: number;
}

/** 默认速率：无聊 ~3h 从 0 到满；精力 ~3.3h 从 0 到满（2C4G 小机器节奏） */
export const DEFAULT_RATES: PropagationRates = {
  boredomPerMinute: 0.55,
  energyPerMinute: 0.5,
};

/** 就绪阈值：无聊攒够 且 精力够跑一轮 */
export const READY_BOREDOM = 70;
export const READY_ENERGY = 40;

/** 一轮游荡的效果：解无聊 -50、耗精力 -30 */
export const WANDER_BOREDOM_RELIEF = 50;
export const WANDER_ENERGY_COST = 30;

/** 按性格解析前推速率（纯函数；好奇=基准 1.0 → 等于 DEFAULT_RATES，存量行为不回退） */
export function resolveRates(
  personality: PersonalityId,
  base: PropagationRates = DEFAULT_RATES,
): PropagationRates {
  const p = getPersonality(personality);
  return {
    boredomPerMinute: base.boredomPerMinute * p.rates.boredomPerMinute,
    energyPerMinute: base.energyPerMinute * p.rates.energyPerMinute,
  };
}

/** 游荡效果（性格系数 × 基准常量，取整保持整数落库） */
export interface WanderEffects {
  boredomRelief: number;
  energyCost: number;
}

export function resolveWanderEffects(personality: PersonalityId): WanderEffects {
  const p = getPersonality(personality);
  return {
    boredomRelief: Math.round(WANDER_BOREDOM_RELIEF * p.wander.boredomRelief),
    energyCost: Math.round(WANDER_ENERGY_COST * p.wander.energyCost),
  };
}

const clamp = (v: number) => Math.min(100, Math.max(0, v));

/** 前推：elapsed = now - (lastRunAt ?? createdAt)，按速率推 boredom/energy 并夹取 */
export function propagate(
  pet: PropagatablePet,
  nowMs: number,
  rates: PropagationRates = DEFAULT_RATES,
): PropagatedState {
  const elapsedMin = Math.max(0, nowMs - (pet.lastRunAt ?? pet.createdAt)) / MINUTE_MS;
  return {
    boredom: clamp(pet.boredom + elapsedMin * rates.boredomPerMinute),
    energy: clamp(pet.energy + elapsedMin * rates.energyPerMinute),
  };
}

/** 就绪判定：无聊 ≥ READY_BOREDOM 且 精力 ≥ READY_ENERGY */
export function isReady(state: PropagatedState): boolean {
  return state.boredom >= READY_BOREDOM && state.energy >= READY_ENERGY;
}
