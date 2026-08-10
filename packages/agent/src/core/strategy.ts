/**
 * 游荡策略生成（纯函数）
 *
 * 从 AgentState + 兴趣话题生成 WanderStrategy。
 * 纯函数设计：不读 InterestGraph（由调用方注入 focusTopics），可独立测试。
 *
 * 状态→行为硬映射（RFC #59 §6）：
 * - 精力 > 70 → maxSteps = ceiling
 * - 精力 30-70 → maxSteps = round(ceiling × 0.6)
 * - 精力 < 30 → maxSteps = round(ceiling × 0.2)，强制 deep
 * - 无聊 > 80 → novel（探索新领域）
 * - 无聊 40-80 → broad
 * - 无聊 < 40 → deep
 * - 心情 excited/playful → speakInclination=high；lazy/emo → low
 */

import type { AgentState, WanderStrategy } from '../types.js';

/**
 * 计算游荡策略。
 *
 * @param state - Agent 状态（energy/boredom/mood）
 * @param maxWanderSteps - 步数上限（来自 config.maxWanderSteps）
 * @param focusTopics - 聚焦话题（来自 InterestGraph top-N 或 fallback）
 */
export function computeStrategy(
  state: AgentState,
  maxWanderSteps: number,
  focusTopics: string[],
): WanderStrategy {
  // ─── 精力 → maxSteps ───
  let maxSteps: number;
  if (state.energy > 70) {
    maxSteps = maxWanderSteps;
  } else if (state.energy >= 30) {
    maxSteps = Math.round(maxWanderSteps * 0.6);
  } else {
    maxSteps = Math.round(maxWanderSteps * 0.2);
  }

  // ─── 无聊 → explorationMode ───
  let explorationMode: WanderStrategy['explorationMode'];
  if (state.boredom > 80) {
    explorationMode = 'novel';
  } else if (state.boredom >= 40) {
    explorationMode = 'broad';
  } else {
    explorationMode = 'deep';
  }

  // 精力过低时强制 deep（不探索新领域，节省精力）
  if (state.energy < 30) {
    explorationMode = 'deep';
  }

  // ─── 心情 → speakInclination ───
  let speakInclination: WanderStrategy['speakInclination'] = 'normal';
  if (state.mood === 'excited' || state.mood === 'playful') {
    speakInclination = 'high';
  } else if (state.mood === 'lazy' || state.mood === 'emo') {
    speakInclination = 'low';
  }

  // ─── 硬约束 ───
  const constraints: string[] = [];
  if (focusTopics.length > 0) {
    constraints.push(`本次游荡的前 3 步搜索中，至少有一次必须围绕"${focusTopics[0]}"展开`);
  }
  if (explorationMode === 'novel') {
    constraints.push('你今天特别想探索没见过的领域，优先搜索之前没搜过的话题');
  }
  if (explorationMode === 'deep' && focusTopics.length > 0) {
    constraints.push(`今天深耕"${focusTopics[0]}"，多角度搜索、多点进链接深读`);
  }

  return { focusTopics, explorationMode, maxSteps, speakInclination, constraints };
}
