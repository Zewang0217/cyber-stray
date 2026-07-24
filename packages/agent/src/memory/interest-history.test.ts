/**
 * InterestHistory 测试套件
 *
 * 覆盖：
 * - 记录快照后读取
 * - 去重：相同状态不重复记录
 * - 状态变化后产生新行
 * - limit / since 过滤
 * - 空图谱边界
 * - 记录失败不抛错（best-effort）
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTempDataDir, restoreFetch } from '../test/helpers.js';
import { _resetInterestGraphCache, getInterestGraph, DEFAULT_INTEREST_CONFIG } from './interest-graph.js';
import { recordInterestSnapshot, getInterestHistory } from './interest-history.js';
import type { InterestSnapshotInput } from './interest-history.js';

// ============================================
// Helpers
// ============================================

function makeSnapshotInput(overrides?: Partial<InterestSnapshotInput>): InterestSnapshotInput {
  return {
    timestamp: new Date().toISOString(),
    nodes: [
      { id: '科技', weight: 0.5, effectiveWeight: 0.45, source: 'default', reinforceCount: 2 },
      { id: 'AI', weight: 0.6, effectiveWeight: 0.55, source: 'reflection', reinforceCount: 3 },
    ],
    entropy: 0.99,
    nodeCount: 2,
    ...overrides,
  };
}

/** 获取历史的第一条记录，断言存在 */
function first<T>(arr: T[]): NonNullable<T> {
  expect(arr.length).toBeGreaterThan(0);
  return arr[0]!;
}

// ============================================
// 测试
// ============================================

describe('InterestHistory', () => {
  let cleanup: () => void;

  beforeEach(() => {
    ({ cleanup } = useTempDataDir());
    _resetInterestGraphCache();
  });

  afterEach(() => {
    cleanup();
    restoreFetch();
    _resetInterestGraphCache();
    vi.restoreAllMocks();
  });

  // ==========================================
  // 基本记录/读取
  // ==========================================

  test('记录快照后可通过 getInterestHistory 读取', async () => {
    await recordInterestSnapshot(makeSnapshotInput());

    const history = await getInterestHistory();
    expect(history.length).toBe(1);
    const entry = first(history);
    expect(entry.nodeCount).toBe(2);
    expect(entry.entropy).toBe(0.99);
    expect(entry.nodes[0]!.id).toBe('科技');
    expect(entry.nodes[1]!.id).toBe('AI');
  });

  test('应该包含 computed hash', async () => {
    await recordInterestSnapshot(makeSnapshotInput());
    const history = await getInterestHistory();
    const entry = first(history);
    expect(entry.hash).toBeDefined();
    expect(entry.hash.length).toBe(8);
  });

  // ==========================================
  // 去重
  // ==========================================

  test('连续记录相同状态只产生一行（去重）', async () => {
    const input = makeSnapshotInput();
    await recordInterestSnapshot(input);
    await recordInterestSnapshot(input); // 相同输入
    await recordInterestSnapshot(input); // 同上

    const history = await getInterestHistory();
    expect(history.length).toBe(1);
  });

  test('状态变化后产生新行', async () => {
    // hash 基于节点 (id:weight:source)，需要变化节点内容而非仅 nodeCount
    await recordInterestSnapshot(makeSnapshotInput({
      nodes: [{ id: '科技', weight: 0.5, effectiveWeight: 0.5, source: 'default', reinforceCount: 0 }],
      nodeCount: 1,
      entropy: 0,
    }));

    await recordInterestSnapshot(makeSnapshotInput({
      nodes: [
        { id: '科技', weight: 0.6, effectiveWeight: 0.55, source: 'default', reinforceCount: 1 },
        { id: 'AI', weight: 0.4, effectiveWeight: 0.4, source: 'reflection', reinforceCount: 0 },
      ],
      nodeCount: 2,
      entropy: 0.99,
    }));

    const history = await getInterestHistory();
    expect(history.length).toBe(2);
    expect(history[0]!.nodeCount).toBe(1);
    expect(history[1]!.nodeCount).toBe(2);
  });

  test('权重变化会产生新 hash（触发新行）', async () => {
    await recordInterestSnapshot(makeSnapshotInput({
      nodes: [{ id: '科技', weight: 0.5, effectiveWeight: 0.5, source: 'default', reinforceCount: 1 }],
    }));

    await recordInterestSnapshot(makeSnapshotInput({
      nodes: [{ id: '科技', weight: 0.7, effectiveWeight: 0.65, source: 'default', reinforceCount: 2 }],
    }));

    const history = await getInterestHistory();
    expect(history.length).toBe(2);
  });

  // ==========================================
  // limit / since 过滤
  // ==========================================

  test('limit 参数应该限制返回数量', async () => {
    for (let i = 0; i < 5; i++) {
      await recordInterestSnapshot(makeSnapshotInput({
        nodeCount: i + 1,
        nodes: [{ id: `topic${i}`, weight: 0.5, effectiveWeight: 0.5, source: 'default', reinforceCount: 0 }],
      }));
    }

    const history = await getInterestHistory(3);
    expect(history.length).toBe(3);
    // 返回最后 3 条
    expect(history[0]!.nodeCount).toBe(3);
    expect(history[2]!.nodeCount).toBe(5);
  });

  test('since 参数应该按时间过滤', async () => {
    // 记录第一条
    await recordInterestSnapshot(makeSnapshotInput({
      nodes: [{ id: 'old', weight: 0.3, effectiveWeight: 0.3, source: 'default', reinforceCount: 0 }],
      nodeCount: 1,
    }));

    // 等待确保时间戳不同
    await new Promise((r) => setTimeout(r, 50));
    const since = new Date().toISOString();

    // 记录第二条（不同节点，避免去重）
    await recordInterestSnapshot(makeSnapshotInput({
      nodes: [{ id: 'new', weight: 0.7, effectiveWeight: 0.7, source: 'reflection', reinforceCount: 1 }],
      nodeCount: 1,
    }));

    const history = await getInterestHistory(50, since);
    expect(history.length).toBe(1);
    expect(history[0]!.nodes[0]!.id).toBe('new');
  });

  // ==========================================
  // 边界
  // ==========================================

  test('无历史文件时返回空数组', async () => {
    const history = await getInterestHistory();
    expect(history).toEqual([]);
  });

  test('记录零节点的快照', async () => {
    await recordInterestSnapshot(makeSnapshotInput({ nodes: [], nodeCount: 0, entropy: 0 }));
    const history = await getInterestHistory();
    expect(history.length).toBe(1);
    expect(history[0]!.nodes).toEqual([]);
    expect(history[0]!.entropy).toBe(0);
  });

  // ==========================================
  // InterestGraph 集成：persist 自动记录快照
  // ==========================================

  test('InterestGraph.persist 应自动记录快照', async () => {
    const graph = getInterestGraph();
    graph.seedDefaults();
    await graph.persist();

    const history = await getInterestHistory();
    expect(history.length).toBe(1);
    const entry = first(history);
    expect(entry.nodeCount).toBe(DEFAULT_INTEREST_CONFIG.defaultSeeds.length);
    // 验证有效权重已计算（带衰减，应该 ≤ 原始权重）
    for (const node of entry.nodes) {
      expect(node.effectiveWeight).toBeGreaterThan(0);
      expect(node.effectiveWeight).toBeLessThanOrEqual(node.weight);
    }
  });

  test('多次 persist 相同状态应去重', async () => {
    const graph = getInterestGraph();
    graph.seedDefaults();
    await graph.persist();
    await graph.persist(); // 无变更，再次 persist

    const history = await getInterestHistory();
    expect(history.length).toBe(1);
  });

  test('兴趣变更后 persist 应产生新快照', async () => {
    const graph = getInterestGraph();
    graph.seedDefaults();
    await graph.persist();

    // 变更：添加强化
    const firstSeed = DEFAULT_INTEREST_CONFIG.defaultSeeds[0]!;
    graph.reinforce(firstSeed, 0.1);
    await graph.persist();

    const history = await getInterestHistory();
    expect(history.length).toBe(2);

    // 验证强化后的节点权重更高
    const reinforcedNode = history[1]!.nodes.find(
      (n) => n.id === firstSeed,
    );
    expect(reinforcedNode).toBeDefined();
    expect(reinforcedNode!.weight).toBeGreaterThan(0.5); // 0.5 + 0.1
  });
});
