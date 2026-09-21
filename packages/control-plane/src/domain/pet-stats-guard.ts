/**
 * 跨进程 statsUpdated 回报的合法性守卫（领域层，纯函数）
 *
 * feedback worker 经 stdout JSON 回报心情增量；落库前必须校验形状——
 * 非法值显式拒绝不写，绝不静默写脏数据（禁兜底）。
 */

import { isPetMood, type PetMood } from '@cyber-stray/shared/pet-stats';

/** worker 回报的心情/脾气增量（statsUpdated） */
export interface StatsUpdate {
  /** 缺省 = 本次不更新心情 */
  mood?: PetMood;
  temper: number;
}

/** 合法：mood 缺省或为合法枚举；temper 为 0-100 的有限数 */
export function isWellFormedStatsUpdate(stats: StatsUpdate): boolean {
  if (stats.mood !== undefined && !isPetMood(stats.mood)) return false;
  return (
    typeof stats.temper === 'number' &&
    Number.isFinite(stats.temper) &&
    stats.temper >= 0 &&
    stats.temper <= 100
  );
}
