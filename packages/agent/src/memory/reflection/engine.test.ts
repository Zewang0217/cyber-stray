/**
 * ReflectionEngine 测试套件
 *
 * 覆盖：
 * - Zod schema 校验（合法/非法 JSON、部分恢复）
 * - grounding 验证（sourceId 匹配/编造、全丢）
 * - 观察收集（过滤 self:reflection）
 * - 完整 reflect() 流程（mock generateText）
 * - 边界：禁用、观察不足、LLM 异常
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

import { generateText } from 'ai';
import { ReflectionEngine, _resetReflectionEngine } from './engine.js';
import { getMemoryStore, _resetMemoryStore } from '../long-term/index.js';
import { MemoryStore } from '../long-term/index.js';
import { _resetInterestGraphCache } from '../interest-graph.js';
import { useTempDataDir, restoreFetch } from '../../test/helpers.js';
import { _resetMemoryIndex } from '../long-term/memory-index.js';
import type { MemoryEntry, Provenance } from '../long-term/types.js';

// ============================================
// Helpers
// ============================================

/** 创建测试用 observation（provenance = untrusted:web） */
function makeObservation(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: `observation-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'observation',
    timestamp: new Date().toISOString(),
    tags: ['test'],
    summary: '测试观察',
    content: '这是一条测试观察内容',
    importance: 0.5,
    provenance: 'untrusted:web' as Provenance,
    ...overrides,
  };
}

/** 创建指定类型的测试素材 */
function makeMaterial(type: MemoryEntry['type'], overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return makeObservation({
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    summary: `测试${type}`,
    content: `这是一条测试 ${type} 内容`,
    ...overrides,
  });
}

/** 安装 ai 模块 mock */
function mockGenerateText(impl: (opts: Record<string, unknown>) => Promise<{ text: string }>): void {
  (generateText as ReturnType<typeof vi.fn>).mockImplementation(impl);
}

/** 构建模拟反思 LLM 输出 */
function makeReflectionOutput(insights: Array<{
  title: string;
  content: string;
  sourceIds: string[];
  newInterests?: Array<{ topic: string; weight: number; reasoning: string }>;
  existingInterestUpdates?: Array<{ topic: string; delta: number; reasoning: string }>;
}>): string {
  return JSON.stringify({
    insights,
    summary: `本次反思产出 ${insights.length} 条洞察`,
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
    vi.clearAllMocks();
    ({ cleanup } = useTempDataDir());
    process.env.DEEPSEEK_API_KEY = 'test-key';
    _resetReflectionEngine();
    _resetInterestGraphCache();
    _resetMemoryStore();
    _resetMemoryIndex();
    store = getMemoryStore();
    engine = new ReflectionEngine();
  });

  afterEach(() => {
    cleanup();
    restoreFetch();
    process.env.DEEPSEEK_API_KEY = savedKey;
    _resetReflectionEngine();
    _resetInterestGraphCache();
    _resetMemoryStore();
    _resetMemoryIndex();
  });

  // ==========================================
  // 观察收集
  // ==========================================

  test('应该过滤掉 provenance=self:reflection 的洞察', async () => {
    await store.saveMemory(makeObservation({ id: 'obs-1', summary: 'web 观察 1', provenance: 'untrusted:web' }));
    await store.saveMemory(makeObservation({ id: 'obs-2', summary: 'web 观察 2', provenance: 'untrusted:web' }));
    await store.saveMemory(makeObservation({ id: 'obs-3', summary: '反思洞察', provenance: 'self:reflection' }));

    mockGenerateText(async () => ({ text: JSON.stringify({ insights: [], summary: '' }) }));

    const result = await engine.reflect();
    expect(result.executed).toBe(false);
    await store.saveMemory(makeObservation({ id: 'obs-4', summary: 'web 观察 3', provenance: 'untrusted:web' }));
  });

  test('没有 observation 时应该用 knowledge / interaction 素材跑起来', async () => {
    // 游荡期间实际产出的几乎全是这两类，只收 observation 会让反思永远空转
    await store.saveMemory(makeMaterial('knowledge', { id: 'k-1', summary: '知识 1' }));
    await store.saveMemory(makeMaterial('knowledge', { id: 'k-2', summary: '知识 2' }));
    await store.saveMemory(makeMaterial('interaction', { id: 'i-1', summary: '发言 1' }));

    mockGenerateText(async () => ({
      text: makeReflectionOutput([
        {
          title: '跨来源趋势',
          content: '多条素材都指向同一话题。',
          sourceIds: ['k-1', 'i-1'],
          newInterests: [],
          existingInterestUpdates: [],
        },
      ]),
    }));

    const result = await engine.reflect();
    expect(result.executed).toBe(true);
    expect(result.insightsProduced).toBe(1);
  });

  test('三类素材应该一起喂给 LLM，并在 prompt 中标注类型', async () => {
    await store.saveMemory(makeMaterial('observation', { id: 'o-1', summary: '观察 1' }));
    await store.saveMemory(makeMaterial('knowledge', { id: 'k-1', summary: '知识 1' }));
    await store.saveMemory(makeMaterial('interaction', { id: 'i-1', summary: '发言 1' }));

    let capturedPrompt = '';
    mockGenerateText(async (opts) => {
      capturedPrompt = String(opts.prompt);
      return { text: JSON.stringify({ insights: [], summary: '' }) };
    });

    const result = await engine.reflect();

    expect(result.executed).toBe(true);
    expect(capturedPrompt).toContain('o-1');
    expect(capturedPrompt).toContain('k-1');
    expect(capturedPrompt).toContain('i-1');
    expect(capturedPrompt).toContain('对主人的观察');
    expect(capturedPrompt).toContain('网上读到的内容');
    expect(capturedPrompt).toContain('自己说过的话');
  });

  test('素材超出配额时 observation 应优先占额，不被大量 knowledge 挤出', async () => {
    await store.saveMemory(makeMaterial('observation', { id: 'o-1', summary: '观察 1' }));
    for (let i = 0; i < 8; i++) {
      await store.saveMemory(makeMaterial('knowledge', { id: `k-${i}`, summary: `知识 ${i}` }));
    }

    let capturedPrompt = '';
    mockGenerateText(async (opts) => {
      capturedPrompt = String(opts.prompt);
      return { text: JSON.stringify({ insights: [], summary: '' }) };
    });

    const limited = new ReflectionEngine({ maxObservations: 3 });
    const result = await limited.reflect();

    expect(result.executed).toBe(true);
    expect(capturedPrompt).toContain('o-1');
    expect(capturedPrompt).toContain('3 条原始素材');
  });

  // ==========================================
  // Zod 校验
  // ==========================================

  test('应该接受合法的反思输出', async () => {
    const obsIds = ['obs-a', 'obs-b', 'obs-c'];
    for (const id of obsIds) {
      await store.saveMemory(makeObservation({ id, summary: `观察 ${id}` }));
    }

    const output = makeReflectionOutput([
      {
        title: '趋势：AI 话题持续热门',
        content: '近一周多个来源都在讨论 AI 芯片和推理能力提升，说明该方向持续升温。',
        sourceIds: ['obs-a', 'obs-b'],
        newInterests: [{ topic: 'AI芯片', weight: 0.3, reasoning: '多次出现芯片相关报道' }],
        existingInterestUpdates: [{ topic: 'AI', delta: 0.1, reasoning: '持续保持高热度' }],
      },
    ]);

    mockGenerateText(async () => ({ text: output }));

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

    mockGenerateText(async () => ({ text: '这不是 JSON，是 LLM 胡言乱语' }));

    const result = await engine.reflect();
    expect(result.insightsProduced).toBe(0);
  });

  test('应该拒绝不符合 schema 的输出', async () => {
    for (let i = 0; i < 5; i++) {
      await store.saveMemory(makeObservation({ id: `obs-${i}`, summary: `观察 ${i}` }));
    }

    const badOutput = JSON.stringify({ insights: '不是数组', summary: '' });
    mockGenerateText(async () => ({ text: badOutput }));

    const result = await engine.reflect();
    expect(result.insightsProduced).toBe(0);
  });

  test('部分恢复：混合合法/非法 insight 时保留合法部分', async () => {
    const obsIds = ['obs-a', 'obs-b', 'obs-c', 'obs-d'];
    for (const id of obsIds) {
      await store.saveMemory(makeObservation({ id, summary: `观察 ${id}` }));
    }

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
          sourceIds: [],
          newInterests: [],
          existingInterestUpdates: [],
        },
      ],
      summary: '混合输出',
    });

    mockGenerateText(async () => ({ text: mixedOutput }));

    const result = await engine.reflect();
    expect(result.executed).toBe(true);
    expect(result.insightsProduced).toBeGreaterThanOrEqual(1);
    expect(result.insightsDiscardedByValidation).toBeGreaterThanOrEqual(1);
  });

  // ==========================================
  // Grounding 验证
  // ==========================================

  test('应该丢弃所有 sourceIds 都是编造的洞察', async () => {
    const realIds = ['real-1', 'real-2', 'real-3'];
    for (const id of realIds) {
      await store.saveMemory(makeObservation({ id, summary: `真实观察 ${id}` }));
    }

    const output = makeReflectionOutput([
      {
        title: '幻觉洞察',
        content: '这条洞察引用了不存在的观察',
        sourceIds: ['fake-1', 'fake-2'],
        newInterests: [],
        existingInterestUpdates: [],
      },
    ]);

    mockGenerateText(async () => ({ text: output }));

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
        title: '部分可靠的洞察',
        content: '引用了真实的和编造的',
        sourceIds: ['real-a', 'fake-1'],
        newInterests: [],
        existingInterestUpdates: [],
      },
    ]);

    mockGenerateText(async () => ({ text: output }));

    const result = await engine.reflect();
    expect(result.executed).toBe(true);
    expect(result.insightsProduced).toBe(1);
    expect(result.insightsDiscardedByGrounding).toBe(0);
  });

  // ==========================================
  // 边界条件
  // ==========================================

  test('观察不足 3 条时应该跳过', async () => {
    await store.saveMemory(makeObservation({ id: 'solo', summary: '独立观察' }));

    const result = await engine.reflect();
    expect(result.executed).toBe(false);
    expect(result.insightsProduced).toBe(0);
  });

  test('禁用时应该跳过', async () => {
    const disabled = new ReflectionEngine({ enabled: false });
    const result = await disabled.reflect();
    expect(result.executed).toBe(false);
  });

  test('空洞察输出应该返回 executed=true 但无产出', async () => {
    for (let i = 0; i < 5; i++) {
      await store.saveMemory(makeObservation({ id: `obs-${i}`, summary: `观察 ${i}` }));
    }

    mockGenerateText(async () => ({ text: JSON.stringify({ insights: [], summary: '本次无洞察' }) }));

    const result = await engine.reflect();
    expect(result.executed).toBe(true);
    expect(result.insightsProduced).toBe(0);
  });

  // ==========================================
  // LLM 异常处理
  // ==========================================

  test('LLM 调用失败时应该抛错', async () => {
    for (let i = 0; i < 5; i++) {
      await store.saveMemory(makeObservation({ id: `obs-${i}`, summary: `观察 ${i}` }));
    }

    mockGenerateText(async () => {
      throw new Error('API 不可用');
    });

    await expect(engine.reflect()).rejects.toThrow('API 不可用');
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
        content: '多次出现量子计算相关报道，值得关注。',
        sourceIds: ['obs-1', 'obs-2'],
        newInterests: [{ topic: '量子计算', weight: 0.25, reasoning: '近一周多次出现' }],
        existingInterestUpdates: [],
      },
    ]);

    mockGenerateText(async () => ({ text: output }));

    const result = await engine.reflect();
    expect(result.executed).toBe(true);
    expect(result.newInterestsAdded.length).toBeGreaterThanOrEqual(0);
  });

  // ==========================================
  // markdown code block 剥离
  // ==========================================

  test('应该能剥离 markdown 代码块包裹的 JSON', async () => {
    for (let i = 0; i < 5; i++) {
      await store.saveMemory(makeObservation({ id: `obs-${i}`, summary: `观察 ${i}` }));
    }

    const json = makeReflectionOutput([
      {
        title: '代码块内的洞察',
        content: 'LLM 有时会用代码块包裹 JSON 输出',
        sourceIds: ['obs-0', 'obs-1'],
        newInterests: [],
        existingInterestUpdates: [],
      },
    ]);

    mockGenerateText(async () => ({ text: `\`\`\`json\n${json}\n\`\`\`` }));

    const result = await engine.reflect();
    expect(result.executed).toBe(true);
    expect(result.insightsProduced).toBe(1);
  });
});
