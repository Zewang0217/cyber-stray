/**
 * 性格 → agent 行为注入（#90）
 *
 * 纯函数：探索倾向（新/旧话题权重）影响游荡聚焦话题选择。
 * 权重语义：InterestGraph 的 weight 与"熟悉度"负相关——反思刚加入的新话题
 * 初始权重 0.2，反复强化的熟悉话题趋近 maxWeight 0.8。因此 (1-weight) 作为
 * "新话题度"代理，与性格的 novelty/familiarity 权重混合打分。
 *
 * 未知性格抛错（禁兜底）；性格解析本身在共享注册表 getPersonality()。
 */

import { getPersonality, type PersonalityId } from '@cyber-stray/shared';

export interface FocusCandidate {
  id: string;
  weight: number;
}

/**
 * 按性格探索倾向挑选本次游荡的聚焦话题。
 *
 * score = weight × familiarity + (1 - weight) × novelty
 * 好奇（novelty 高）→ 低权重新话题被抬升；慵懒（familiarity 高）→ 熟悉话题主导。
 */
export function pickFocusTopics(
  candidates: FocusCandidate[],
  personality: PersonalityId,
  count: number,
): string[] {
  const { novelty, familiarity } = getPersonality(personality).exploration;
  return [...candidates]
    .map((c) => ({ id: c.id, score: c.weight * familiarity + (1 - c.weight) * novelty }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((s) => s.id);
}
