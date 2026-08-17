/**
 * 无聊/精力时间前推（S5）
 *
 * 纯函数：编排状态 time-propagable——不常驻进程，读宠物行 + 当前时刻即可
 * 推出此刻的无聊/精力（无聊随时间上升，精力随时间恢复），夹取 0-100。
 * 前推值是瞬时视图；SQLite 只在游荡写回时落盘（避免每 tick 写库）。
 */

export const MINUTE_MS = 60_000;

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
