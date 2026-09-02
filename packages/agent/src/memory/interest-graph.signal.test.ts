/**
 * S2 #151：多信号权重公式 + 叶子归因 + 父聚合 测试
 *
 * 覆盖：
 * - applySignal 确定性数学（like 饱和增长 / dislike 比例衰减 / boost 强于 like）
 * - 边际递减（信号越多阻尼越小，1/(1+0.2n)）
 * - 叶子归因（父级目标 → 落叶子）与 dislike 隔离（兄弟/父级语义）
 * - 父节点权重 = 子加权聚合（attachChild / recomputeParentWeight / persist）
 */

import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { InterestGraph, SIGNAL_STRENGTH } from './interest-graph.js';

const MAX_WEIGHT = 0.8;
let seq = 0;

function makeGraph(): InterestGraph {
  // 独立临时路径：InterestGraph 构造不需要文件存在（persist 时才建）
  const dir = join(tmpdir(), `s2-signal-${process.pid}-${Date.now()}-${seq++}`);
  return new InterestGraph(join(dir, 'interests.json'), {
    decayLambda: 0.0116,
    maxWeight: MAX_WEIGHT,
    minInterestCount: 5, // 冷启动期足够长：测试 addInterest 权重不被 novelty 预算钳制
    maxInterestCount: 20,
    noveltyBudget: 0.5,
    defaultSeeds: [],
    minWeight: 0.01,
  });
}

describe('S2 多信号权重公式', () => {
  it('like 饱和增长：0.3 + 1.0×(0.8−0.3) = 0.8 到顶不越界', () => {
    const g = makeGraph();
    g.addInterest('天文', 0.3, 'feedback');
    g.applySignal('天文', 'like');
    expect(g.getNode('天文')!.weight).toBeCloseTo(0.8, 10);
    // 到顶后再 like 不越界
    g.applySignal('天文', 'like');
    expect(g.getNode('天文')!.weight).toBeLessThanOrEqual(MAX_WEIGHT);
  });

  it('dislike 比例衰减：0.8 − 1.5×0.8 → 钳 0', () => {
    const g = makeGraph();
    g.addInterest('天文', 0.8, 'feedback');
    g.applySignal('天文', 'dislike');
    expect(g.getNode('天文')!.weight).toBe(0);
  });

  it('dislike 温和场景：0.5 − 1.5×1×0.5 → 钳 0（强度 1.5 一步到底）', () => {
    const g = makeGraph();
    g.addInterest('AI', 0.5, 'feedback');
    g.applySignal('AI', 'dislike');
    expect(g.getNode('AI')!.weight).toBe(0);
  });

  it('boost 强于 like（2.0 vs 1.0）', () => {
    const g = makeGraph();
    g.addInterest('AI', 0.3, 'feedback');
    g.applySignal('AI', 'boost');
    expect(g.getNode('AI')!.weight).toBeCloseTo(0.8, 10);
  });

  it('边际递减：dislike 两次下降量递减', () => {
    const g = makeGraph();
    g.addInterest('科技', 0.8, 'feedback');
    const w0 = g.getNode('科技')!.weight;
    g.applySignal('科技', 'dislike'); // n=1 → 阻尼 1/1.2
    const drop1 = w0 - g.getNode('科技')!.weight;
    const w1 = g.getNode('科技')!.weight;
    g.applySignal('科技', 'dislike'); // n=2 → 阻尼 1/1.4
    const drop2 = w1 - g.getNode('科技')!.weight;
    expect(drop1).toBeGreaterThan(drop2);
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
  it('attachChild 建层级后父权重 = 子均值', () => {
    const g = makeGraph();
    g.addInterest('科学', 0.5, 'default');
    g.addInterest('物理', 0.4, 'default');
    g.addInterest('化学', 0.6, 'default');
    expect(g.attachChild('科学', '物理')).toBe(true);
    expect(g.attachChild('科学', '化学')).toBe(true);
    // 挂接即聚合：(0.4+0.6)/2 = 0.5
    expect(g.getNode('科学')!.weight).toBeCloseTo(0.5, 10);
    expect(g.getNode('物理')!.parent).toBe('科学');
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

  it('dislike 目标叶子 → 兄弟不受影响，父级经聚合反映', () => {
    const g = makeGraph();
    g.addInterest('科学', 0.5, 'default');
    g.addInterest('物理', 0.5, 'default');
    g.addInterest('化学', 0.5, 'default');
    g.attachChild('科学', '物理');
    g.attachChild('科学', '化学');
    expect(g.getNode('科学')!.weight).toBeCloseTo(0.5, 10);

    const physBefore = g.getNode('物理')!.weight;
    const chemBefore = g.getNode('化学')!.weight;
    g.applySignal('物理', 'dislike');
    expect(g.getNode('物理')!.weight).toBeLessThan(physBefore);
    expect(g.getNode('化学')!.weight).toBe(chemBefore); // 兄弟完全不受影响
    const expectedParent = (g.getNode('物理')!.weight + chemBefore) / 2;
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
    expect(g.getNode('物理')!.weight).toBeCloseTo(0.8, 10); // 0.4+1.0×0.4
    expect(g.getNode('科学')!.weight).toBeCloseTo(0.7, 10); // (0.8+0.6)/2
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