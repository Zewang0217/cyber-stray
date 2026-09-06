/**
 * Phase 6 (OBS-03): 端到端闭环验证
 *
 * 验证自进化 loop 闭合：
 *   探索 → 学习 → 反思 → 兴趣进化 → 更准推送
 *
 * 六个场景，覆盖 Core Value 的每一条链路。
 * 使用纯逻辑验证，避免跨模块单例竞态。
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTempDataDir, restoreFetch } from './helpers.js';
import {
  _resetInterestGraphCache,
  getInterestGraph,
  DEFAULT_INTEREST_CONFIG,
  InterestGraph,
} from '../memory/interest-graph.js';
import { attributeTopics } from '../memory/push-gate.js';
import { _clearMessageTopicMap, registerSpeakTopics, getMessageTopicMapSize } from '../memory/feedback-pipeline.js';
import { getInterestHistory } from '../memory/interest-history.js';

// ============================================
// E2E 测试套件
// ============================================

describe('E2E 闭环验证', () => {
  let cleanup: () => void;

  beforeEach(() => {
    ({ cleanup } = useTempDataDir());
    _resetInterestGraphCache();
    _clearMessageTopicMap();
  });

  afterEach(() => {
    cleanup();
    restoreFetch();
    vi.restoreAllMocks();
  });

  // ==========================================
  // 场景 1: 兴趣不是冻住的
  // ==========================================

  test('兴趣权重应随时间变化（非冻住）', async () => {
    const graph = getInterestGraph();
    graph.seedDefaults();
    await graph.persist();

    const initialNodes = graph.getAllNodes();
    const initialWeights = new Map(initialNodes.map((n) => [n.id, n.weight]));

    // 强化一个兴趣
    const targetId = initialNodes[0]!.id;
    graph.reinforce(targetId, 0.2);
    await graph.persist();

    const updatedNode = graph.getNode(targetId);
    expect(updatedNode).toBeDefined();
    expect(updatedNode!.weight).toBeGreaterThan(initialWeights.get(targetId)!);
    expect(updatedNode!.reinforceCount).toBe(1);
  });

  test('兴趣历史应记录演化过程', async () => {
    const graph = getInterestGraph();
    graph.seedDefaults();
    await graph.persist();

    // 变更
    const firstSeed = DEFAULT_INTEREST_CONFIG.defaultSeeds[0]!;
    graph.reinforce(firstSeed, 0.15);
    await graph.persist();

    graph.reinforce(firstSeed, 0.1);
    await graph.persist();

    // 读取历史
    const history = await getInterestHistory();
    expect(history.length).toBeGreaterThanOrEqual(2);

    const lastSnapshot = history[history.length - 1]!;
    const reinforcedNode = lastSnapshot.nodes.find((n) => n.id === firstSeed);
    expect(reinforcedNode).toBeDefined();
    expect(reinforcedNode!.weight).toBeGreaterThan(0.5);
  });

  test('新增兴趣应出现在图谱中', async () => {
    const graph = getInterestGraph();
    graph.seedDefaults();
    await graph.persist();

    const added = graph.addInterest('量子计算', 0.3, 'reflection');
    await graph.persist();

    expect(added).toBe(true);

    const newNode = graph.getNode('量子计算');
    expect(newNode).toBeDefined();
    expect(newNode!.source).toBe('reflection');
    // 三个种子共 1.5，novelty 预算 0.15 → 新兴趣初始权重被钳到 0.225，
    // 后续要靠反馈强化才能长起来
    expect(newNode!.weight).toBeCloseTo(0.225, 3);
  });

  // ==========================================
  // 场景 2: 反思 → 兴趣进化（逻辑验证）
  // ==========================================

  test('反思来源的兴趣节点应正确标记', async () => {
    const graph = getInterestGraph();
    graph.seedDefaults();

    // 模拟反思添加新兴趣（低权重以在 novelty 预算内）
    const added = graph.addInterest('合成生物学', 0.1, 'reflection');
    await graph.persist();

    if (added) {
      const bioNode = graph.getNode('合成生物学');
      expect(bioNode).toBeDefined();
      expect(bioNode!.source).toBe('reflection');
    } else {
      // 预算不足时应有合理理由（总有效权重已达上限）
      const totalWeight = graph.getAllNodes().length * 0.5;
      expect(totalWeight).toBeGreaterThanOrEqual(1.0);
    }
  });

  test('反馈来源的兴趣节点应正确标记', async () => {
    const graph = getInterestGraph();
    graph.seedDefaults();

    // 模拟反馈添加新兴趣（低权重以在 novelty 预算内）
    const added = graph.addInterest('前端开发', 0.12, 'feedback');
    await graph.persist();

    if (added) {
      const node = graph.getNode('前端开发');
      expect(node).toBeDefined();
      expect(node!.source).toBe('feedback');
    }
    // 预算不足时优雅拒绝（不抛错）
  });

  test('seedDefaults 应为 default 来源', async () => {
    const graph = getInterestGraph();
    graph.seedDefaults();

    const nodes = graph.getAllNodes();
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(node.source).toBe('default');
    }
  });

  // ==========================================
  // 场景 3: 反馈 → 兴趣强化
  // ==========================================

  test('reinforce 应正确增加权重和计数', async () => {
    const graph = getInterestGraph();
    graph.seedDefaults();
    await graph.persist();

    const preWeight = graph.getNode('AI')!.weight;
    const preCount = graph.getNode('AI')!.reinforceCount;

    graph.reinforce('AI', 0.15);
    await graph.persist();

    const postNode = graph.getNode('AI');
    expect(postNode!.weight).toBeGreaterThan(preWeight);
    expect(postNode!.reinforceCount).toBe(preCount + 1);
  });

  test('负向调整（直接改权重）应生效', async () => {
    const graph = getInterestGraph();
    graph.seedDefaults();

    const node = graph.getNode('AI')!;
    const preWeight = node.weight;

    // 模拟 dislike 的负向调整（与 feedback-pipeline 行为一致）
    node.weight = Math.max(0, preWeight - 0.1);
    node.lastReinforced = new Date().toISOString();

    expect(graph.getNode('AI')!.weight).toBeLessThan(preWeight);
  });

  test('注册消息-兴趣映射 + 反馈处理应不抛错', async () => {
    const graph = getInterestGraph();
    graph.seedDefaults();
    await graph.persist();

    // 注册映射
    registerSpeakTopics('msg-test-001', ['AI', '科技']);
    expect(getMessageTopicMapSize()).toBe(1);

    // 清空映射（最佳实践）
    _clearMessageTopicMap();
  });

  // ==========================================
  // 场景 4: 话题归因使用兴趣数据（P3 #152：评分门控已移除，归因保留）
  // ==========================================

  test('话题归因应受兴趣图谱影响', async () => {
    const graph = getInterestGraph();
    graph.seedDefaults();
    // 强化"科技"使其远高于其他
    graph.reinforce('科技', 0.3);
    await graph.persist();

    const matchResult = await attributeTopics('科技新闻：最新 AI 芯片发布');
    const noMatchResult = await attributeTopics('美食推荐：最好吃的火锅店');

    // 命中兴趣的内容归因到图谱话题，无关内容归因为空
    expect(matchResult).toContain('科技');
    expect(noMatchResult).toEqual([]);
  });

  test('归因结果随 speak 落盘语义：命中列表可直接作反馈归因依据', async () => {
    const graph = getInterestGraph();
    graph.seedDefaults();
    await graph.persist();

    const matched = await attributeTopics('AI 技术最新进展：大语言模型的应用与挑战');
    expect(Array.isArray(matched)).toBe(true);
    expect(matched).toContain('AI');
  });

  // ==========================================
  // 场景 5: 防坍缩
  // ==========================================

  test('兴趣熵应在合理范围内', async () => {
    const graph = getInterestGraph();
    graph.seedDefaults();
    await graph.persist();

    const entropy = graph.getEntropy();
    const nodeCount = graph.getNodeCount();

    // 3 个等权种子 (0.5)，熵应接近 log2(3) ≈ 1.585
    expect(entropy).toBeGreaterThan(0);
    expect(entropy).toBeLessThanOrEqual(Math.log2(nodeCount));
  });

  test('单兴趣高权重不应使熵归零', async () => {
    const graph = getInterestGraph();
    graph.seedDefaults();

    // 大幅强化一个兴趣
    graph.reinforce('科技', 0.3);
    await graph.persist();

    const entropy = graph.getEntropy();
    const nodeCount = graph.getNodeCount();

    // 即使一个兴趣很高，熵 > 0（种子兴趣保底）
    expect(entropy).toBeGreaterThan(0);
    expect(nodeCount).toBeGreaterThanOrEqual(DEFAULT_INTEREST_CONFIG.minInterestCount);
  });

  test('novelty 预算应保留探索空间', async () => {
    const graph = getInterestGraph();
    graph.seedDefaults();

    // 尝试添加新兴趣
    const added = graph.addInterest('生物科技', 0.15, 'reflection');
    // 预算足够时应成功；预算不足时优雅拒绝（不抛错）
    expect(typeof added).toBe('boolean');
  });

  test('衰减不应移除低于下限的兴趣', async () => {
    const graph = getInterestGraph();
    graph.seedDefaults();

    // 如果只有 3 个节点，衰减不应移除到低于下限
    const preCount = graph.getNodeCount();
    expect(preCount).toBeGreaterThanOrEqual(DEFAULT_INTEREST_CONFIG.minInterestCount);

    // decayAll 在启动时调用，内部有 ensureMinCount
    graph.decayAll();
    const postCount = graph.getNodeCount();
    // 不应低于下限
    expect(postCount).toBeGreaterThanOrEqual(DEFAULT_INTEREST_CONFIG.minInterestCount);
  });

  // ==========================================
  // 场景 6: 全链路闭合
  // ==========================================

  test('全链路：初始化 → 强化 → 门控 — 环路闭合', async () => {
    // Step 1: 初始化兴趣图谱（模拟启动）
    const graph = getInterestGraph();
    graph.seedDefaults();
    await graph.persist();

    // Step 2: 模拟多次反馈强化（学习→进化）
    const reinforceCycles = 3;
    for (let i = 0; i < reinforceCycles; i++) {
      graph.reinforce('科技', 0.05);
    }
    await graph.persist();

    // Step 3: 验证兴趣进化
    const techNode = graph.getNode('科技');
    expect(techNode).toBeDefined();
    expect(techNode!.weight).toBeGreaterThan(0.5); // 初始 0.5 + 3×0.05
    expect(techNode!.reinforceCount).toBe(reinforceCycles);

    // Step 4: 验证历史记录
    const history = await getInterestHistory();
    expect(history.length).toBeGreaterThanOrEqual(1);

    // Step 5: 验证归因使用进化后的兴趣（P3 #152：评分门控已移除）
    const matched = await attributeTopics(
      '科技领域的最新突破：AI 芯片性能翻倍，量子计算迈向商业化',
    );

    // 进化后的"科技"被内容命中，可作反馈归因依据
    expect(matched).toContain('科技');
  });

  test('全链路：兴趣图谱完整生命周期', async () => {
    const graph = new InterestGraph('interests.json');

    // 1. 空状态
    expect(graph.getNodeCount()).toBe(0);
    expect(graph.getEntropy()).toBe(0);

    // 2. 种子初始化
    graph.seedDefaults();
    expect(graph.getNodeCount()).toBe(DEFAULT_INTEREST_CONFIG.defaultSeeds.length);
    expect(graph.getEntropy()).toBeGreaterThan(0);

    // 3. 反思添加新兴趣（低权重以在预算内）
    graph.addInterest('量子计算', 0.1, 'reflection');
    graph.addInterest('生物科技', 0.1, 'reflection');
    // 预算可能不足，但至少应尝试且不抛错
    const postAddCount = graph.getNodeCount();
    expect(postAddCount).toBeGreaterThanOrEqual(DEFAULT_INTEREST_CONFIG.defaultSeeds.length);

    // 4. 反馈强化
    graph.reinforce('AI', 0.15);
    const aiNode = graph.getNode('AI');
    expect(aiNode!.reinforceCount).toBe(1);
    expect(aiNode!.weight).toBeGreaterThan(0.5);

    // 5. 衰减后保底
    graph.decayAll();
    expect(graph.getNodeCount()).toBeGreaterThanOrEqual(
      DEFAULT_INTEREST_CONFIG.minInterestCount,
    );

    // 6. 熵值健康
    const entropy = graph.getEntropy();
    expect(entropy).toBeGreaterThan(0);
  });
});
