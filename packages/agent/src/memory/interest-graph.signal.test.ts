/**
 * S2 #151：多信号权重公式 + 叶子归因 + 父聚合 测试
 *
 * 覆盖：
 * - applySignal 确定性数学（#151 字面公式：±强度 × 阻尼(1/(1+0.2n)) × (1−weight)，
 *   clamp 到 [0, maxWeight]）
 * - dislike 温和场景不退到 0（review #159 回归：防"点踩一次抹掉话题"的单信号污染）
 * - 边际递减（同权重下信号越多阻尼越小）
 * - 叶子归因（父级目标 → 落叶子）与 dislike 隔离（兄弟/父级语义）
 * - 父节点权重 = 子节点加权聚合（证据质量 = 1+reinforceCount）
 */

import { describe, it, expect } from 'vitest';
import { InterestGraph, SIGNAL_STRENGTH } from './interest-graph.js';
import { INTEREST_DECAY_LAMBDA } from './interest-constants.js';
import { makeTestInterestGraph } from '../test/helpers.js';

const MAX_WEIGHT = 0.8;

function makeGraph(): InterestGraph {
  return makeTestInterestGraph();
}

describe('S2 时间衰减常量（#151：半衰期 60 天）', () => {
  it('λ = ln2/60：60 天后有效权重恰好衰减为一半', () => {
    const w0 = 1;
    const w60 = w0 * Math.exp(-INTEREST_DECAY_LAMBDA * 60);
    expect(w60).toBeCloseTo(0.5, 12);
  });

  it('默认配置引用单源常量（防 config.ts 与 DEFAULT_INTEREST_CONFIG 双同步回潮）', () => {
    expect(INTEREST_DECAY_LAMBDA).toBeGreaterThan(0);
    expect(INTEREST_DECAY_LAMBDA).toBeCloseTo(Math.LN2 / 60, 15);
  });
});

describe('S2 多信号权重公式（#151 字面公式）', () => {
  it('like 饱和增长：0.3 + 1.0×(1−0.3) = 1.0 → 钳 maxWeight 0.8，到顶不越界', () => {
    const g = makeGraph();
    g.addInterest('天文', 0.3, 'feedback');
    g.applySignal('天文', 'like');
    expect(g.getNode('天文')!.weight).toBeCloseTo(0.8, 10);
    // 到顶后再 like 不越界
    g.applySignal('天文', 'like');
    expect(g.getNode('天文')!.weight).toBeLessThanOrEqual(MAX_WEIGHT);
  });

  it('like 中段确定性：0.5（n=1 阻尼 1/1.2）→ 0.5 + 1/1.2×0.5 = 0.917 → 钳 0.8', () => {
    // 构造 w=0.5、n=1：0.8 经 dislike（0.8−1.5×0.2）得到
    const g = makeGraph();
    g.addInterest('天文', 0.8, 'feedback');
    g.applySignal('天文', 'dislike');
    expect(g.getNode('天文')!.weight).toBeCloseTo(0.5, 10);
    // 旧实现 (maxWeight−weight) 饱和项在此得 0.75，spec 公式 (1−weight) 钳到 0.8
    g.applySignal('天文', 'like');
    expect(g.getNode('天文')!.weight).toBeCloseTo(0.8, 10);
  });

  it('dislike 强兴趣不退到 0（回归 #159）：0.8 − 1.5×(1−0.8) = 0.5', () => {
    const g = makeGraph();
    g.addInterest('天文', 0.8, 'feedback');
    g.applySignal('天文', 'dislike');
    expect(g.getNode('天文')!.weight).toBeCloseTo(0.5, 10);
  });

  it('dislike 弱兴趣一步清零：0.3 − 1.5×0.7 < 0 → 钳 0', () => {
    const g = makeGraph();
    g.addInterest('AI', 0.3, 'feedback');
    g.applySignal('AI', 'dislike');
    expect(g.getNode('AI')!.weight).toBe(0);
  });

  it('dislike 温和场景（n=5 阻尼 1/2）不退到 0：0.8 − 1.5×0.5×0.2 = 0.65（回归 #159）', () => {
    const g = makeGraph();
    g.addInterest('天文', 0.8, 'feedback');
    // like 到顶不动权重但累计 n → 5
    for (let i = 0; i < 5; i++) g.applySignal('天文', 'like');
    expect(g.getNode('天文')!.reinforceCount).toBe(5);
    g.applySignal('天文', 'dislike');
    expect(g.getNode('天文')!.weight).toBeCloseTo(0.65, 10);
  });

  it('boost 强于 like（2.0 vs 1.0）：0.3 + 2.0×0.7 = 1.7 → 钳 0.8', () => {
    const g = makeGraph();
    g.addInterest('AI', 0.3, 'feedback');
    g.applySignal('AI', 'boost');
    expect(g.getNode('AI')!.weight).toBeCloseTo(0.8, 10);
  });

  it('边际递减（同权重不同 n）：n=0 点踩降 0.3，n=5 点踩只降 0.15', () => {
    const g = makeGraph();
    g.addInterest('科技', 0.8, 'feedback');
    g.addInterest('AI', 0.8, 'feedback');
    const dropN0 = 0.8 - (() => {
      g.applySignal('科技', 'dislike');
      return g.getNode('科技')!.weight;
    })();
    // AI 累计 5 次 like（到顶不动权重），n=5 → 阻尼 1/2
    for (let i = 0; i < 5; i++) g.applySignal('AI', 'like');
    const dropN5 = 0.8 - (() => {
      g.applySignal('AI', 'dislike');
      return g.getNode('AI')!.weight;
    })();
    expect(dropN0).toBeCloseTo(0.3, 10);
    expect(dropN5).toBeCloseTo(0.15, 10);
    expect(dropN5).toBeLessThan(dropN0);
  });

  it('信号强度表符合 #151 字面', () => {
    expect(SIGNAL_STRENGTH).toEqual({ like: 1.0, boost: 2.0, dislike: 1.5 });
  });

  it('lastReinforced 与 reinforceCount 更新', () => {
    const g = makeGraph();
    g.addInterest('AI', 0.3, 'feedback');
    g.applySignal('AI', 'like');
    const node = g.getNode('AI')!;
    expect(node.reinforceCount).toBe(1);
    expect(Number.isNaN(new Date(node.lastReinforced).getTime())).toBe(false);
  });

  it('信号应用到不存在的节点返回 undefined', () => {
    const g = makeGraph();
    expect(g.applySignal('不存在', 'like')).toBeUndefined();
  });
});

describe('S2 层级：父聚合 + dislike 隔离', () => {
  it('attachChild 建层级后父权重 = 子均值（等证据质量退化为算术平均）', () => {
    const g = makeGraph();
    g.addInterest('科学', 0.5, 'default');
    g.addInterest('物理', 0.4, 'default');
    g.addInterest('化学', 0.6, 'default');
    expect(g.attachChild('科学', '物理')).toBe(true);
    expect(g.attachChild('科学', '化学')).toBe(true);
    // 挂接即聚合：(0.4×1+0.6×1)/(1+1) = 0.5
    expect(g.getNode('科学')!.weight).toBeCloseTo(0.5, 10);
    expect(g.getNode('物理')!.parent).toBe('科学');
  });

  it('父聚合按证据质量加权：高反馈子节点主导父级（非算术平均）', () => {
    const g = makeGraph();
    g.addInterest('科学', 0.5, 'default');
    // 物理：0.8 + like×3 → w=0.8、n=3（证据质量 4）
    g.addInterest('物理', 0.8, 'default');
    for (let i = 0; i < 3; i++) g.applySignal('物理', 'like');
    g.addInterest('化学', 0.6, 'default');
    g.attachChild('科学', '物理');
    g.attachChild('科学', '化学');
    // (0.8×4 + 0.6×1) / (4+1) = 0.76；算术平均是 0.7
    expect(g.getNode('科学')!.weight).toBeCloseTo(0.76, 10);
  });

  it('attachChild 非法挂接返回 false', () => {
    const g = makeGraph();
    g.addInterest('科学', 0.5, 'default');
    expect(g.attachChild('科学', '不存在')).toBe(false);
    expect(g.attachChild('不存在', '科学')).toBe(false);
    expect(g.attachChild('科学', '科学')).toBe(false); // 自挂
  });

  it('isLeaf / getLeafDescendants 语义', () => {
    const g = makeGraph();
    g.addInterest('科学', 0.5, 'default');
    g.addInterest('物理', 0.4, 'default');
    g.addInterest('化学', 0.6, 'default');
    g.attachChild('科学', '物理');
    g.attachChild('科学', '化学');
    expect(g.isLeaf('科学')).toBe(false);
    expect(g.isLeaf('物理')).toBe(true);
    expect(g.getLeafDescendants('科学').sort()).toEqual(['化学', '物理']);
    expect(g.getLeafDescendants('物理')).toEqual(['物理']);
  });

  it('dislike 目标叶子 → 兄弟不受影响，父级经加权聚合反映', () => {
    const g = makeGraph();
    g.addInterest('科学', 0.5, 'default');
    g.addInterest('物理', 0.5, 'default');
    g.addInterest('化学', 0.5, 'default');
    g.attachChild('科学', '物理');
    g.attachChild('科学', '化学');
    expect(g.getNode('科学')!.weight).toBeCloseTo(0.5, 10);

    const chemBefore = g.getNode('化学')!.weight;
    g.applySignal('物理', 'dislike');
    // 0.5 − 1.5×(1−0.5) → 钳 0，n=1（证据质量 2）；化学 n=0（质量 1）
    expect(g.getNode('物理')!.weight).toBe(0);
    expect(g.getNode('化学')!.weight).toBe(chemBefore); // 兄弟完全不受影响
    // 父 = (0×2 + 0.5×1) / 3 = 1/6（算术平均是 0.25）
    const expectedParent = (g.getNode('物理')!.weight * 2 + chemBefore * 1) / 3;
    expect(g.getNode('科学')!.weight).toBeCloseTo(expectedParent, 10);
  });

  it('like 叶子 → 父级自动重聚合', () => {
    const g = makeGraph();
    g.addInterest('科学', 0.5, 'default');
    g.addInterest('物理', 0.4, 'default');
    g.addInterest('化学', 0.6, 'default');
    g.attachChild('科学', '物理');
    g.attachChild('科学', '化学');
    g.applySignal('物理', 'like');
    // 0.4 + 1.0×(1−0.4) = 1.0 → 钳 0.8（n=1，质量 2）
    expect(g.getNode('物理')!.weight).toBeCloseTo(0.8, 10);
    // 父 = (0.8×2 + 0.6×1) / 3 = 2.2/3
    expect(g.getNode('科学')!.weight).toBeCloseTo(2.2 / 3, 10);
  });

  it('persist 前统一重聚合：手工改子后父同步落盘', async () => {
    const g = makeGraph();
    g.addInterest('科学', 0.5, 'default');
    g.addInterest('物理', 0.5, 'default');
    g.attachChild('科学', '物理');
    await g.persist();
    expect(g.getNode('科学')!.weight).toBe(g.getNode('物理')!.weight);
  });
});

describe('S2 扁平图谱兼容', () => {
  it('无层级时所有节点为叶子，信号直落，兄弟不受影响', () => {
    const g = makeGraph();
    g.addInterest('科技', 0.5, 'default');
    g.addInterest('AI', 0.5, 'default');
    expect(g.isLeaf('科技')).toBe(true);
    g.applySignal('AI', 'like');
    expect(g.getNode('科技')!.weight).toBeCloseTo(0.5, 10);
    expect(g.getNode('AI')!.weight).toBeGreaterThan(0.5);
  });
});
