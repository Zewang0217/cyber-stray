/**
 * InterestGraph 测试
 *
 * 覆盖：加载/持久化 round-trip、衰减计算、权重上限、novelty 预算、
 * 数量下限补充、熵计算、单例行为。
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  InterestGraph,
  getInterestGraph,
  _resetInterestGraphCache,
  buildInterestConfig,
  initializeInterestGraph,
  DEFAULT_INTEREST_CONFIG,
} from './interest-graph.js';
import { useTempDataDir } from '../test/helpers.js';

describe('InterestGraph', () => {
  let cleanup: () => void;

  beforeEach(() => {
    const temp = useTempDataDir();
    cleanup = temp.cleanup;
    _resetInterestGraphCache();
  });

  afterEach(() => {
    cleanup();
  });

  // ----------------------------------------
  // 基础 CRUD
  // ----------------------------------------

  it('should create empty graph with default data', () => {
    const graph = new InterestGraph('data/interests.json');
    expect(graph.getNodeCount()).toBe(0);
    expect(graph.getAllNodes()).toEqual([]);
  });

  it('should add interest and return it', () => {
    const graph = new InterestGraph('data/interests.json');
    const ok = graph.addInterest('量子计算', 0.3, 'default');
    expect(ok).toBe(true);
    expect(graph.getNodeCount()).toBe(1);

    const node = graph.getNode('量子计算');
    expect(node).toBeDefined();
    expect(node!.weight).toBe(0.3);
    expect(node!.source).toBe('default');
    expect(node!.reinforceCount).toBe(0);
  });

  it('should reject duplicate interest', () => {
    const graph = new InterestGraph('data/interests.json');
    graph.addInterest('量子计算', 0.3);
    const ok = graph.addInterest('量子计算', 0.5);
    expect(ok).toBe(false);
    expect(graph.getNodeCount()).toBe(1);
  });

  it('should reinforce existing interest', () => {
    const graph = new InterestGraph('data/interests.json');
    graph.addInterest('量子计算', 0.3);
    const ok = graph.reinforce('量子计算', 0.2);
    expect(ok).toBe(true);
    expect(graph.getNode('量子计算')!.weight).toBe(0.5);
    expect(graph.getNode('量子计算')!.reinforceCount).toBe(1);
  });

  it('should return false when reinforcing non-existent interest', () => {
    const graph = new InterestGraph('data/interests.json');
    const ok = graph.reinforce('不存在', 0.2);
    expect(ok).toBe(false);
  });

  // ----------------------------------------
  // 权重上限封顶
  // ----------------------------------------

  it('should cap weight at maxWeight', () => {
    const graph = new InterestGraph('data/interests.json', {
      ...DEFAULT_INTEREST_CONFIG,
      maxWeight: 0.8,
    });
    graph.addInterest('量子计算', 0.7);
    graph.reinforce('量子计算', 0.2);
    expect(graph.getNode('量子计算')!.weight).toBe(0.8); // capped
  });

  // ----------------------------------------
  // 时间衰减
  // ----------------------------------------

  it('should decay weight over time', () => {
    const graph = new InterestGraph('data/interests.json', {
      ...DEFAULT_INTEREST_CONFIG,
      decayLambda: 1.0, // 强衰减便于测试
    });

    const now = new Date().toISOString();
    // 手动构造一个 2 天前的节点
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    graph.addInterest('旧兴趣', 0.5);
    // 篡改 lastReinforced 为 2 天前
    const node = graph.getNode('旧兴趣')!;
    node.lastReinforced = twoDaysAgo;

    const effective = graph.getTopInterestsWithWeights(1)[0];
    expect(effective).toBeDefined();
    // weight * exp(-1.0 * 2) = 0.5 * 0.135 ≈ 0.067
    expect(effective.weight).toBeLessThan(0.1);
    expect(effective.weight).toBeGreaterThan(0.05);
  });

  it('should remove dormant nodes after decayAll', () => {
    const graph = new InterestGraph('data/interests.json', {
      ...DEFAULT_INTEREST_CONFIG,
      decayLambda: 10.0, // 极强衰减
      minWeight: 0.05,
      minInterestCount: 0, // 关闭自动补充，方便验证移除
      defaultSeeds: [],
    });

    graph.addInterest('旧兴趣', 0.1);
    // 篡改 lastReinforced 为 10 天前
    const node = graph.getNode('旧兴趣')!;
    node.lastReinforced = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    graph.decayAll();
    expect(graph.getNodeCount()).toBe(0); // 被移除
  });

  // ----------------------------------------
  // 数量下限补充
  // ----------------------------------------

  it('should replenish from default seeds when below minInterestCount', () => {
    const graph = new InterestGraph('data/interests.json', {
      ...DEFAULT_INTEREST_CONFIG,
      decayLambda: 10.0,
      minWeight: 0.05,
      minInterestCount: 3,
      defaultSeeds: ['科技', 'AI', '互联网'],
    });

    graph.addInterest('旧兴趣', 0.1);
    const node = graph.getNode('旧兴趣')!;
    node.lastReinforced = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    graph.decayAll();
    // 旧兴趣被移除，但会从 defaultSeeds 补充到 3 个
    expect(graph.getNodeCount()).toBe(3);
    expect(graph.getNode('科技')).toBeDefined();
    expect(graph.getNode('AI')).toBeDefined();
    expect(graph.getNode('互联网')).toBeDefined();
  });

  // ----------------------------------------
  // Novelty 预算
  // ----------------------------------------

  it('should reject new interest when novelty budget exceeded', () => {
    const graph = new InterestGraph('data/interests.json', {
      ...DEFAULT_INTEREST_CONFIG,
      noveltyBudget: 0.1,
    });

    // 先加满到接近上限
    graph.addInterest('兴趣A', 0.5);
    graph.addInterest('兴趣B', 0.4);
    // 总权重 0.9，noveltyBudget 0.1，上限 1.0
    // 再加 0.2 会超出 1.0 + 0.1 = 1.1？不对，当前是 0.9 + 0.2 = 1.1 > 1.0 + 0.1 = 1.1
    // 正好等于上限，应该允许
    const ok1 = graph.addInterest('兴趣C', 0.2);
    expect(ok1).toBe(true);

    // 再加就超了
    const ok2 = graph.addInterest('兴趣D', 0.1);
    expect(ok2).toBe(false);
  });

  // ----------------------------------------
  // 熵计算
  // ----------------------------------------

  it('should compute entropy for uniform distribution', () => {
    const graph = new InterestGraph('data/interests.json');
    graph.addInterest('A', 0.5);
    graph.addInterest('B', 0.5);
    // 两个等权重，熵 = -0.5*log2(0.5) - 0.5*log2(0.5) = 1.0
    expect(graph.getEntropy()).toBeCloseTo(1.0, 1);
  });

  it('should compute lower entropy for skewed distribution', () => {
    const graph = new InterestGraph('data/interests.json');
    graph.addInterest('A', 0.8);
    graph.addInterest('B', 0.2);
    // 偏斜分布，熵 < 1.0
    const entropy = graph.getEntropy();
    expect(entropy).toBeLessThan(1.0);
    expect(entropy).toBeGreaterThan(0);
  });

  it('should return 0 entropy for empty graph', () => {
    const graph = new InterestGraph('data/interests.json');
    expect(graph.getEntropy()).toBe(0);
  });

  // ----------------------------------------
  // 持久化 round-trip
  // ----------------------------------------

  it('should persist and reload graph', async () => {
    const { mkdir } = await import('fs/promises');
    await mkdir('data', { recursive: true });
    const graph = new InterestGraph('data/interests.json');
    graph.addInterest('量子计算', 0.3);
    graph.reinforce('量子计算', 0.2);
    await graph.persist();

    // 新建实例加载同一文件
    const graph2 = new InterestGraph('data/interests.json');
    await graph2.load();

    expect(graph2.getNodeCount()).toBe(1);
    expect(graph2.getNode('量子计算')!.weight).toBe(0.5);
    expect(graph2.getNode('量子计算')!.reinforceCount).toBe(1);
  });

  it('should throw on corrupted JSON', async () => {
    const { writeFile, mkdir } = await import('fs/promises');
    await mkdir('data', { recursive: true });
    await writeFile('data/interests.json', 'not-json', 'utf-8');

    const graph = new InterestGraph('data/interests.json');
    expect(graph.load()).rejects.toThrow('兴趣图谱解析失败');
  });

  // ----------------------------------------
  // 单例行为
  // ----------------------------------------

  it('should return same instance from getInterestGraph', () => {
    const g1 = getInterestGraph('data/interests.json');
    const g2 = getInterestGraph('data/interests.json');
    expect(g1).toBe(g2);
  });

  it('should return different instances after _resetInterestGraphCache', () => {
    const g1 = getInterestGraph('data/interests.json');
    _resetInterestGraphCache();
    const g2 = getInterestGraph('data/interests.json');
    expect(g1).not.toBe(g2);
  });

  // ----------------------------------------
  // 初始化流程
  // ----------------------------------------

  it('should seed defaults on initialize when file missing', async () => {
    const graph = await initializeInterestGraph();
    expect(graph.isInitialized()).toBe(true);
    expect(graph.getNodeCount()).toBe(3);
    expect(graph.getNode('科技')).toBeDefined();
  });

  it('should load existing file on initialize', async () => {
    const { mkdir } = await import('fs/promises');
    await mkdir('data', { recursive: true });
    // 使用 getInterestGraph 的默认路径（getDataPath('interests.json')）
    // 而不是硬编码 'data/interests.json'，确保路径一致
    const { getInterestGraph, _resetInterestGraphCache } = await import('./interest-graph.js');
    const { getDataPath } = await import('../config.js');
    const graphPath = getDataPath('interests.json');
    const graph = new (await import('./interest-graph.js')).InterestGraph(graphPath, {
      ...DEFAULT_INTEREST_CONFIG,
      defaultSeeds: [],
      minInterestCount: 0,
    });
    graph.addInterest('量子计算', 0.3);
    await graph.persist();

    _resetInterestGraphCache();
    const graph2 = await initializeInterestGraph({
      ...DEFAULT_INTEREST_CONFIG,
      defaultSeeds: [],
      minInterestCount: 0,
    });
    expect(graph2.getNodeCount()).toBe(1);
    expect(graph2.getNode('量子计算')).toBeDefined();
  });

  // ----------------------------------------
  // getTopInterests
  // ----------------------------------------

  it('should return top interests sorted by weight', () => {
    const graph = new InterestGraph('data/interests.json', {
      ...DEFAULT_INTEREST_CONFIG,
      noveltyBudget: 0.5, // 放宽预算以便测试
    });
    graph.addInterest('低权重', 0.2);
    graph.addInterest('高权重', 0.8);
    graph.addInterest('中权重', 0.5);

    const tops = graph.getTopInterests(2);
    expect(tops).toEqual(['高权重', '中权重']);
  });

  it('should filter by minWeight', () => {
    const graph = new InterestGraph('data/interests.json');
    graph.addInterest('高权重', 0.8);
    graph.addInterest('低权重', 0.1);

    const tops = graph.getTopInterests(10, 0.5);
    expect(tops).toEqual(['高权重']);
  });

  // ----------------------------------------
  // buildInterestConfig
  // ----------------------------------------

  it('should merge partial config', () => {
    const cfg = buildInterestConfig({ maxWeight: 0.9 });
    expect(cfg.maxWeight).toBe(0.9);
    expect(cfg.decayLambda).toBe(DEFAULT_INTEREST_CONFIG.decayLambda);
    expect(cfg.defaultSeeds).toEqual(DEFAULT_INTEREST_CONFIG.defaultSeeds);
  });

  it('should override defaultSeeds when provided', () => {
    const cfg = buildInterestConfig({ defaultSeeds: ['音乐', '艺术'] });
    expect(cfg.defaultSeeds).toEqual(['音乐', '艺术']);
  });
});
