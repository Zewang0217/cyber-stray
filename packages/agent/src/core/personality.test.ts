/**
 * 性格探索倾向测试（#90）
 *
 * 契约：pickFocusTopics 纯函数——按性格的新/旧话题权重混合打分，
 * 从候选兴趣中挑 top-N 作为本次游荡聚焦话题：
 * - 好奇（novelty 高）：低权重（较新/未被反复强化）的话题更容易进聚焦
 * - 慵懒（familiarity 高）：高权重（熟悉/常逛）的话题占主导
 * - 未知性格抛错（禁兜底）
 */

import { describe, it, expect } from 'vitest';
import { pickFocusTopics } from './personality.js';

/** 权重近似低 = 新话题（reflection 刚加入 0.2）；高 = 熟悉话题（反复强化趋近 0.8） */
const CANDIDATES = [
  { id: 'AI', weight: 0.8 },
  { id: '科技', weight: 0.7 },
  { id: '量子计算', weight: 0.25 },
  { id: '冷门民俗', weight: 0.2 },
  { id: '猫咪', weight: 0.15 },
];

describe('pickFocusTopics（性格探索倾向）', () => {
  it('好奇：新话题进聚焦（novelty 0.65 > familiarity 0.35）', () => {
    const picked = pickFocusTopics(CANDIDATES, 'curious', 3);
    // 打分 = weight×0.35 + (1-weight)×0.65；低权重话题被显著抬升
    const scores = CANDIDATES.map((c) => c.weight * 0.35 + (1 - c.weight) * 0.65);
    const expected = [...CANDIDATES]
      .map((c, i) => ({ id: c.id, score: scores[i]! }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((s) => s.id);
    expect(picked).toEqual(expected);
    // 探索倾向生效的显式断言：猫咪(0.15)或冷门民俗(0.2)必须压过 AI(0.8)
    expect(picked).not.toContain('AI');
    expect(picked.some((id) => id === '猫咪' || id === '冷门民俗')).toBe(true);
  });

  it('慵懒：熟悉话题主导（familiarity 0.7 > novelty 0.3）', () => {
    const picked = pickFocusTopics(CANDIDATES, 'lazy', 3);
    expect(picked[0]).toBe('AI'); // 最高权重话题稳居第一
    expect(picked).toContain('科技');
    expect(picked).not.toContain('猫咪'); // 最冷门话题进不了聚焦
  });

  it('活泼：中性偏向（新旧混合，不极端）', () => {
    const picked = pickFocusTopics(CANDIDATES, 'playful', 2);
    expect(picked).toHaveLength(2);
    // 0.55/0.45：高权重仍占优但冷门不会全灭
    const top = [...CANDIDATES]
      .map((c) => ({ id: c.id, score: c.weight * 0.45 + (1 - c.weight) * 0.55 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((s) => s.id);
    expect(picked).toEqual(top);
  });

  it('count 截断与空候选', () => {
    expect(pickFocusTopics(CANDIDATES, 'steady', 1)).toHaveLength(1);
    expect(pickFocusTopics([], 'curious', 3)).toEqual([]);
  });

  it('未知性格抛错（禁兜底）', () => {
    // @ts-expect-error 故意传非法 id 验证运行时守卫
    expect(() => pickFocusTopics(CANDIDATES, 'grumpy', 3)).toThrow(/grumpy/);
  });
});
