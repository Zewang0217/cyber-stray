/**
 * runOneWander — 双租户隔离测试（S1 验收：同一进程先后跑两个租户的游荡，
 * 数据目录/配置隔离，互不串数据；既有单用户行为不变由全量既有测试保障）
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFile, writeFile, access } from 'fs/promises';

vi.mock('ai', () => ({
  generateText: vi.fn(),
  stepCountIs: vi.fn(() => () => false),
  hasToolCall: vi.fn(() => () => false),
  tool: vi.fn((def: Record<string, unknown>) => ({ ...def })),
}));

vi.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: vi.fn(() => ({
    chat: vi.fn(() => ({ modelId: 'mock-model' })),
  })),
}));

import { generateText } from 'ai';
import { runOneWander } from './run-one-wander.js';
import { loadConfig, setTenantContext } from '../config.js';
import { ToolManager } from '../tools/tool-manager.js';
import { getMemoryStore, _resetMemoryStore } from '../memory/long-term/index.js';
import { _resetMemoryIndex } from '../memory/long-term/memory-index.js';
import { _resetInterestGraphCache } from '../memory/interest-graph.js';
import { _resetReflectionScheduler } from '../memory/reflection/index.js';
import { _resetSkillIndex } from '../tools/browser/skills/skill-index.js';

function mockGenerateTextWithSteps(steps: number): void {
  (generateText as ReturnType<typeof vi.fn>).mockImplementation(async (opts: {
    onStepFinish?: (event: { stepNumber: number; usage: { inputTokens: number; outputTokens: number } }) => Promise<void>;
  }) => {
    for (let i = 0; i < steps; i++) {
      await opts.onStepFinish?.({ stepNumber: i, usage: { inputTokens: 10, outputTokens: 2 } });
    }
    return {
      text: '',
      toolCalls: [],
      steps: [],
      finishReason: 'stop',
    };
  });
}

/** 创建独立租户数据目录 */
function makeTenantDir(label: string): { tenantId: string; dataDir: string } {
  const root = mkdtempSync(join(tmpdir(), `cyber-stray-tenant-${label}-`));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir, { recursive: true });
  return { tenantId: label, dataDir };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('runOneWander 双租户隔离', () => {
  let dirs: { tenantId: string; dataDir: string }[] = [];
  const savedKey = process.env.DEEPSEEK_API_KEY;
  /** ADR-0013：数值注入必传（真相源在 CP pets 表） */
  const PET_STATS = { energy: 80, boredom: 70, mood: 'curious' as const, temper: 20 };

  beforeEach(() => {
    vi.clearAllMocks();
    dirs = [];
    process.env.DEEPSEEK_API_KEY = 'test-key';
    ToolManager.reset();
    _resetMemoryStore();
    _resetMemoryIndex();
    _resetInterestGraphCache();
    _resetReflectionScheduler();
    _resetSkillIndex();
    mockGenerateTextWithSteps(2);
  });

  afterEach(async () => {
    for (const d of dirs) {
      await rmSync(join(d.dataDir, '..'), { recursive: true, force: true });
    }
    if (savedKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = savedKey;
    }
  });

  test('同一进程先后跑两个租户：状态/记忆/历史各自落盘，互不串数据', async () => {
    const tA = makeTenantDir('a');
    const tB = makeTenantDir('b');
    dirs = [tA, tB];

    // 租户 A 第一次游荡
    const rA1 = await runOneWander({ ...tA, petStats: PET_STATS });
    expect(rA1.endReason).not.toBe('error');

    const aStatePath = join(tA.dataDir, 'state.json');
    expect(await fileExists(aStatePath)).toBe(true);
    const aState1 = JSON.parse(await readFile(aStatePath, 'utf-8'));
    expect(aState1.totalWanders).toBe(1);
    expect(await fileExists(join(tA.dataDir, 'wander-history.json'))).toBe(true);

    // 租户 A 的游荡没有污染租户 B 的目录
    expect(await fileExists(join(tB.dataDir, 'state.json'))).toBe(false);

    // 租户 B 第一次游荡
    const rB1 = await runOneWander({ ...tB, petStats: PET_STATS });
    expect(rB1.endReason).not.toBe('error');

    const bStatePath = join(tB.dataDir, 'state.json');
    expect(await fileExists(bStatePath)).toBe(true);
    const bState1 = JSON.parse(await readFile(bStatePath, 'utf-8'));
    expect(bState1.totalWanders).toBe(1);

    // 租户 A 的状态不被 B 的游荡触碰（仍是 1，不是 2）
    const aStateAfterB = JSON.parse(await readFile(aStatePath, 'utf-8'));
    expect(aStateAfterB.totalWanders).toBe(1);

    // 数值退役（ADR-0013）：state.json 数值字段冻结为创建时的默认值，
    // 游荡不再触碰（真相源在 CP pets 表）；新数值按实际步数随结果回报
    expect(aStateAfterB.boredom).toBe(30); // loadState 默认值，未被动过
    expect(aStateAfterB.energy).toBe(80);
    expect(rB1.stats).toEqual({
      energy: PET_STATS.energy - rB1.steps * 2, // energyCostPerStep=2
      boredom: PET_STATS.boredom - rB1.steps * 2, // boredomReductionPerStep=2
    });

    // 租户 A 第二次游荡：只增 A 自己的计数
    await runOneWander({ ...tA, petStats: PET_STATS });
    const aState2 = JSON.parse(await readFile(aStatePath, 'utf-8'));
    expect(aState2.totalWanders).toBe(2);
    const bState2 = JSON.parse(await readFile(bStatePath, 'utf-8'));
    expect(bState2.totalWanders).toBe(1);
  });

  test('ADR-0013 写回保性格差异：playful 耗能更多/解无聊更快（系数 × 实际步数）', async () => {
    const tP = makeTenantDir('playful');
    dirs = [tP];
    const r = await runOneWander({
      ...tP,
      personality: 'playful',
      petStats: { energy: 80, boredom: 70, mood: 'curious', temper: 20 },
    });
    expect(r.stats).toEqual({
      energy: Math.round(80 - r.steps * 2 * 1.15), // playful energyCost 1.15
      boredom: Math.round(70 - r.steps * 2 * 1.1), // playful boredomRelief 1.1
    });
  });

  test('租户配置隔离：各租户读自己的 agent-config.json 行为参数', async () => {
    const tA = makeTenantDir('a');
    const tB = makeTenantDir('b');
    dirs = [tA, tB];

    // 租户 A 配置 maxWanderSteps=7；租户 B 不配（默认 100）
    await writeFile(join(tA.dataDir, 'agent-config.json'), JSON.stringify({ maxWanderSteps: 7 }));

    const cfgA = loadConfig(tA.dataDir);
    const cfgB = loadConfig(tB.dataDir);
    expect(cfgA.maxWanderSteps).toBe(7);
    expect(cfgB.maxWanderSteps).toBe(100);
  });

  test('per-tenant secrets 注入：getConfig 生效于该租户游荡期间', async () => {
    const tA = makeTenantDir('a');
    dirs = [tA];

    await runOneWander({ ...tA, petStats: PET_STATS, secrets: { deepseekApiKey: 'tenant-a-key' } });

    // 游荡结束后租户上下文已清除，回到单用户默认
    const { getTenantContext } = await import('../config.js');
    expect(getTenantContext()).toBeNull();
  });

  test('第五次短命游荡返回前，反思洞察及调度进度已持久化', async () => {
    const tenant = makeTenantDir('reflection');
    dirs = [tenant];
    setTenantContext({ ...tenant, config: loadConfig(tenant.dataDir) });
    const store = getMemoryStore();
    for (const id of ['obs-1', 'obs-2', 'obs-3']) {
      await store.saveMemory({ id, type: 'observation', timestamp: new Date().toISOString(),
        tags: [], summary: '量子计算进展', content: '量子纠错获得进展',
        importance: 0.7, provenance: 'untrusted:web' });
    }
    setTenantContext(null);
    await writeFile(join(tenant.dataDir, 'reflection-state.json'), JSON.stringify({
      wanderCount: 4, totalReflections: 0, lastReflectionAt: null,
    }));
    vi.mocked(generateText).mockImplementation(async (opts) => {
      if ('onStepFinish' in opts) return { text: '', steps: [], toolCalls: [] } as never;
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(opts.temperature).toBe(0.4);
      return { usage: { inputTokens: 10, outputTokens: 2 }, text: JSON.stringify({ summary: '反思完成', insights: [{
        title: '量子纠错趋势', content: '来自真实观察的洞察', sourceIds: ['obs-1'],
        newInterests: [], existingInterestUpdates: [],
      }] }) } as never;
    });

    await runOneWander({ ...tenant, petStats: PET_STATS });
    const state = JSON.parse(await readFile(join(tenant.dataDir, 'reflection-state.json'), 'utf8'));
    expect(state).toMatchObject({ wanderCount: 5, totalReflections: 1 });
    const memories = await store.getRecentMemories({ count: 20 });
    expect(memories.some((m) => m.provenance === 'self:reflection' && m.tags.includes('ref:obs-1'))).toBe(true);
  });

  test('损坏的反思进度显式失败，不重置成首次游荡', async () => {
    const tenant = makeTenantDir('broken-reflection');
    dirs = [tenant];
    await writeFile(join(tenant.dataDir, 'reflection-state.json'), '{broken');
    await expect(runOneWander({ ...tenant, petStats: PET_STATS })).rejects.toThrow();
    expect(await readFile(join(tenant.dataDir, 'reflection-state.json'), 'utf8')).toBe('{broken');
  });

  test('反思失败保留已完成游荡回报，重启后先重试反思再开展新游荡', async () => {
    const tenant = makeTenantDir('reflection-retry');
    dirs = [tenant];
    setTenantContext({ ...tenant, config: loadConfig(tenant.dataDir) });
    for (const id of ['obs-1', 'obs-2', 'obs-3']) {
      await getMemoryStore().saveMemory({ id, type: 'observation', timestamp: new Date().toISOString(),
        tags: [], summary: '量子进展', content: '真实观察', importance: 0.7, provenance: 'untrusted:web' });
    }
    setTenantContext(null);
    await writeFile(join(tenant.dataDir, 'reflection-state.json'), JSON.stringify({
      wanderCount: 4, totalReflections: 0, lastReflectionAt: null,
    }));
    const calls: string[] = [];
    let reflectionFails = true;
    vi.mocked(generateText).mockImplementation(async (opts) => {
      if (opts.onStepFinish) {
        calls.push('wander');
        await (opts.onStepFinish as (step: unknown) => Promise<void>)({
          stepNumber: 0, usage: { inputTokens: 10, outputTokens: 2 }, toolCalls: [],
        });
        return { text: '', steps: [], toolCalls: [] } as never;
      }
      calls.push('reflection');
      if (reflectionFails) throw new Error('reflection provider unavailable');
      return { text: JSON.stringify({ summary: '已反思', insights: [] }),
        usage: { inputTokens: 10, outputTokens: 2 } } as never;
    });
    await expect(runOneWander({ ...tenant, petStats: PET_STATS })).rejects.toMatchObject({
      message: expect.stringContaining('reflection provider unavailable'),
      result: { stats: { energy: 78, boredom: 68 } },
    });
    const saved = JSON.parse(await readFile(join(tenant.dataDir, 'reflection-state.json'), 'utf8'));
    expect(saved.pendingReflection).toBe(true);
    expect(JSON.parse(await readFile(join(tenant.dataDir, 'state.json'), 'utf8')).totalWanders).toBe(1);
    _resetReflectionScheduler();
    // 再次反思失败时只重试反思，不重复已完成的游荡。
    await expect(runOneWander({ ...tenant, petStats: PET_STATS })).rejects.toThrow('reflection provider unavailable');
    reflectionFails = false;
    _resetReflectionScheduler();
    await runOneWander({ ...tenant, petStats: PET_STATS });
    expect(calls).toEqual(['wander', 'reflection', 'reflection', 'reflection', 'wander']);
    expect(JSON.parse(await readFile(join(tenant.dataDir, 'reflection-state.json'), 'utf8')))
      .toMatchObject({ wanderCount: 6, totalReflections: 1, pendingReflection: false });
  });
});
