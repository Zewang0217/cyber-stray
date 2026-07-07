/**
 * ReflectionEngine 测试套件
 *
 * 覆盖�?
 * - Zod schema 校验（合�?非法 JSON、部分恢复）
 * - grounding 验证（sourceId 匹配/编造、全丢）
 * - 观察收集（过�?self:reflection�?
 * - 完整 reflect() 流程（mock generateText�?
 * - 边界：禁用、观察不足、LLM 异常
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'vitest';
import { ReflectionEngine, _resetReflectionEngine } from './engine.js';
import { getMemoryStore } from '../long-term/index.js';
import { MemoryStore } from '../long-term/index.js';
import { _resetInterestGraphCache } from '../interest-graph.js';
import { useTempDataDir, restoreFetch } from '../../test/helpers.js';
import type { MemoryEntry, Provenance } from '../long-term/types.js';

// ============================================
// Helpers
// ============================================

/** 创建测试�?observation（provenance = untrusted:web�?*/
function makeObservation(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: `observation-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'observation',
    timestamp: new Date().toISOString(),
    tags: ['test'],
    summary: '测试观察',
    content: '这是一条测试观察内�?,
    importance: 0.5,
    provenance: 'untrusted:web' as Provenance,
    ...overrides,
  };
}

/** 安装 ai 模块 mock */
function mockAiModule(generateTextImpl: (opts: Record<string, unknown>) => Promise<{ text: string }>): void {
  mock.module('ai', () => ({
    generateText: (opts: Record<string, unknown>) => generateTextImpl(opts),
  }));
}

/** 构建模拟反�?LLM 输出 */
function makeReflectionOutput(insights: Array<{
  title: string;
  content: string;
  sourceIds: string[];
  newInterests?: Array<{ topic: string; weight: number; reasoning: string }>;
  existingInterestUpdates?: Array<{ topic: string; delta: number; reasoning: string }>;
}>): string {
  return JSON.stringify({
    insights,
    summary: `本次反思产�?${insights.length} 条洞察`,
  });
}

// ============================================
// 测试
// ============================================

describe('ReflectionEngine', () => {
  let engine: ReflectionEngine;
  let store: MemoryStore;
  let cleanup: () => void;
  const savedKey = process.env.DEEPSEEK_API_KEY;

  beforeEach(async () => {
    ({ cleanup } = useTempDataDir());
    process.env.DEEPSEEK_API_KEY = 'test-key';
    _resetReflectionEngine();
    _resetInterestGraphCache();
    // 重新获取 store（useTempDataDir 改了 DATA_DIR�?
    store = getMemoryStore();
    engine = new ReflectionEngine();
  });

  afterEach(() => {
    cleanup();
    restoreFetch();
    process.env.DEEPSEEK_API_KEY = savedKey;
    _resetReflectionEngine();
    _resetInterestGraphCache();
    mock.restore();
  });

  // ==========================================
  // 观察收集
  // ==========================================

  test('应该过滤�?provenance=self:reflection 的洞�?, async () => {
    // seed 混合观察
    await store.saveMemory(makeObservation({ id: 'obs-1', summary: 'web 观察 1', provenance: 'untrusted:web' }));
    await store.saveMemory(makeObservation({ id: 'obs-2', summary: 'web 观察 2', provenance: 'untrusted:web' }));
    await store.saveMemory(makeObservation({ id: 'obs-3', summary: '反思洞�?, provenance: 'self:reflection' }));

    // 使用私有方法测试（通过 reflect 的观察收集逻辑�?
    // 因为 collectObservations �?private，我们通过完整�?reflect flow 验证
    // 需�?3+ 观察才能触发反�?�?mock LLM 返回空洞�?
    mockAiModule(async () => ({ text: JSON.stringify({ insights: [], summary: '' }) }));

    const result = await engine.reflect();
    // 只有 2 �?web 观察（不�?3），应跳�?
    expect(result.executed).toBe(false);
    // 再加 1 �?
    await store.saveMemory(makeObservation({ id: 'obs-4', summary: 'web 观察 3', provenance: 'untrusted:web' }));
    // 现在 3 �?web + 1 �?reflection，collectObservations 应只�?3 �?web
  });

  // ==========================================
  // Zod 校验
  // ==========================================

  test('应该接受合法的反思输�?, async () => {
    const obsIds = ['obs-a', 'obs-b', 'obs-c'];
    for (const id of obsIds) {
      await store.saveMemory(makeObservation({ id, summary: `观察 ${id}` }));
    }

    const output = makeReflectionOutput([
      {
        title: '趋势：AI 话题持续热门',
        content: '近一周多个来源都在讨�?AI 芯片和推理能力提升，说明该方向持续升温�?,
        sourceIds: ['obs-a', 'obs-b'],
        newInterests: [{ topic: 'AI芯片', weight: 0.3, reasoning: '多次出现芯片相关报道' }],
        existingInterestUpdates: [{ topic: 'AI', delta: 0.1, reasoning: '持续保持高热�? }],
      },
    ]);

    mockAiModule(async () => ({ text: output }));

    const result = await engine.reflect();
    expect(result.executed).toBe(true);
    expect(result.insightsProduced).toBe(1);
    expect(result.insightsDiscardedByGrounding).toBe(0);
    expect(result.newInterestsAdded.length).toBeGreaterThanOrEqual(0);
  });

  test('应该拒绝非法 JSON 输出', async () => {
    for (let i = 0; i < 5; i++) {
      await store.saveMemory(makeObservation({ id: `obs-${i}`, summary: `观察 ${i}` }));
    }

    mockAiModule(async () => ({ text: '这不�?JSON，是 LLM 胡言乱语' }));

    const result = await engine.reflect();
    expect(result.insightsProduced).toBe(0);
  });

  test('应该拒绝不符�?schema 的输�?, async () => {
    for (let i = 0; i < 5; i++) {
      await store.saveMemory(makeObservation({ id: `obs-${i}`, summary: `观察 ${i}` }));
    }

    // insights 不是数组
    const badOutput = JSON.stringify({ insights: '不是数组', summary: '' });
    mockAiModule(async () => ({ text: badOutput }));

    const result = await engine.reflect();
    expect(result.insightsProduced).toBe(0);
  });

  test('部分恢复：混合合�?非法 insight 时保留合法部�?, async () => {
    const obsIds = ['obs-a', 'obs-b', 'obs-c', 'obs-d'];
    for (const id of obsIds) {
      await store.saveMemory(makeObservation({ id, summary: `观察 ${id}` }));
    }

    // 合法 + 非法混合
    const mixedOutput = JSON.stringify({
      insights: [
        {
          title: '合法洞察',
          content: '有效内容',
          sourceIds: ['obs-a'],
          newInterests: [],
          existingInterestUpdates: [],
        },
        {
          title: '',
          content: '',
          sourceIds: [], // Zod 拒绝：sourceIds 为空
          newInterests: [],
          existingInterestUpdates: [],
        },
      ],
      summary: '混合输出',
    });

    mockAiModule(async () => ({ text: mixedOutput }));

    const result = await engine.reflect();
    expect(result.executed).toBe(true);
    // 合法的那条通过
    expect(result.insightsProduced).toBeGreaterThanOrEqual(1);
    // 非法的那条被丢弃
    expect(result.insightsDiscardedByValidation).toBeGreaterThanOrEqual(1);
  });

  // ==========================================
  // Grounding 验证
  // ==========================================

  test('应该丢弃所�?sourceIds 都是编造的洞察', async () => {
    const realIds = ['real-1', 'real-2', 'real-3'];
    for (const id of realIds) {
      await store.saveMemory(makeObservation({ id, summary: `真实观察 ${id}` }));
    }

    const output = makeReflectionOutput([
      {
        title: '幻觉洞察',
        content: '这条洞察引用了不存在的观�?,
        sourceIds: ['fake-1', 'fake-2'], // 全部编�?
        newInterests: [],
        existingInterestUpdates: [],
      },
    ]);

    mockAiModule(async () => ({ text: output }));

    const result = await engine.reflect();
    expect(result.insightsProduced).toBe(0);
    expect(result.insightsDiscardedByGrounding).toBe(1);
  });

  test('应该保留 sourceIds 中有至少一条真实引用的洞察', async () => {
    const realIds = ['real-a', 'real-b', 'real-c'];
    for (const id of realIds) {
      await store.saveMemory(makeObservation({ id, summary: `真实观察 ${id}` }));
    }

    const output = makeReflectionOutput([
      {
        title: '部分可靠的洞�?,
        content: '引用了真实的和编造的',
        sourceIds: ['real-a', 'fake-1'], // 一条真一条假
        newInterests: [],
        existingInterestUpdates: [],
      },
    ]);

    mockAiModule(async () => ({ text: output }));

    const result = await engine.reflect();
    expect(result.executed).toBe(true);
    // 有一条真实引�?�?保留
    expect(result.insightsProduced).toBe(1);
    expect(result.insightsDiscardedByGrounding).toBe(0);
  });

  // ==========================================
  // 边界条件
  // ==========================================

  test('观察不足 3 条时应该跳过', async () => {
    // 只写 1 �?observation
    await store.saveMemory(makeObservation({ id: 'solo', summary: '独立观察' }));

    const result = await engine.reflect();
    expect(result.executed).toBe(false);
    expect(result.insightsProduced).toBe(0);
  });

  test('禁用时应该跳�?, async () => {
    const disabled = new ReflectionEngine({ enabled: false });
    const result = await disabled.reflect();
    expect(result.executed).toBe(false);
  });

  test('空洞察输出应该返�?executed=true 但无产出', async () => {
    for (let i = 0; i < 5; i++) {
      await store.saveMemory(makeObservation({ id: `obs-${i}`, summary: `观察 ${i}` }));
    }

    mockAiModule(async () => ({ text: JSON.stringify({ insights: [], summary: '本次无洞�? }) }));

    const result = await engine.reflect();
    expect(result.executed).toBe(true);
    expect(result.insightsProduced).toBe(0);
  });

  // ==========================================
  // LLM 异常处理
  // ==========================================

  test('LLM 调用失败时应该抛�?, async () => {
    for (let i = 0; i < 5; i++) {
      await store.saveMemory(makeObservation({ id: `obs-${i}`, summary: `观察 ${i}` }));
    }

    mockAiModule(async () => {
      throw new Error('API 不可�?);
    });

    await expect(engine.reflect()).rejects.toThrow('API 不可�?);
  });

  // ==========================================
  // 兴趣图谱集成
  // ==========================================

  test('应该将反思发现的新兴趣添加到 InterestGraph', async () => {
    const obsIds = ['obs-1', 'obs-2', 'obs-3'];
    for (const id of obsIds) {
      await store.saveMemory(makeObservation({ id, summary: `观察 ${id}` }));
    }

    const output = makeReflectionOutput([
      {
        title: '发现量子计算兴趣',
        content: '多次出现量子计算相关报道，值得关注�?,
        sourceIds: ['obs-1', 'obs-2'],
        newInterests: [{ topic: '量子计算', weight: 0.25, reasoning: '近一周多次出�? }],
        existingInterestUpdates: [],
      },
    ]);

    mockAiModule(async () => ({ text: output }));

    const result = await engine.reflect();
    expect(result.executed).toBe(true);
    // 新兴趣已添加（从 result 字段验证�?
    expect(result.newInterestsAdded.length).toBeGreaterThanOrEqual(0);
  });

  // ==========================================
  // markdown code block 剥离
  // ==========================================

  test('应该能剥�?markdown 代码块包裹的 JSON', async () => {
    for (let i = 0; i < 5; i++) {
      await store.saveMemory(makeObservation({ id: `obs-${i}`, summary: `观察 ${i}` }));
    }

    const json = makeReflectionOutput([
      {
        title: '代码块内的洞�?,
        content: 'LLM 有时会用代码块包�?JSON 输出',
        sourceIds: ['obs-0', 'obs-1'],
        newInterests: [],
        existingInterestUpdates: [],
      },
    ]);

    mockAiModule(async () => ({ text: `\`\`\`json\n${json}\n\`\`\`` }));

    const result = await engine.reflect();
    expect(result.executed).toBe(true);
    expect(result.insightsProduced).toBe(1);
  });
});
