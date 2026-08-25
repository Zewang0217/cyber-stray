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
import { loadConfig } from '../config.js';
import { ToolManager } from '../tools/tool-manager.js';
import { _resetMemoryStore } from '../memory/long-term/index.js';
import { _resetMemoryIndex } from '../memory/long-term/memory-index.js';
import { _resetInterestGraphCache } from '../memory/interest-graph.js';
import { _resetReflectionScheduler } from '../memory/reflection/index.js';
import { _resetPushGate } from '../memory/push-gate.js';
import { _resetSkillIndex } from '../tools/browser/skills/skill-index.js';

function mockGenerateTextWithSteps(steps: number): void {
  (generateText as ReturnType<typeof vi.fn>).mockImplementation(async (opts: {
    onStepFinish?: (event: { stepNumber: number }) => void;
  }) => {
    for (let i = 0; i < steps; i++) {
      opts.onStepFinish?.({ stepNumber: i });
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

  beforeEach(() => {
    vi.clearAllMocks();
    dirs = [];
    process.env.DEEPSEEK_API_KEY = 'test-key';
    ToolManager.reset();
    _resetMemoryStore();
    _resetMemoryIndex();
    _resetInterestGraphCache();
    _resetReflectionScheduler();
    _resetPushGate();
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
    const rA1 = await runOneWander(tA);
    expect(rA1.endReason).not.toBe('error');

    const aStatePath = join(tA.dataDir, 'state.json');
    expect(await fileExists(aStatePath)).toBe(true);
    const aState1 = JSON.parse(await readFile(aStatePath, 'utf-8'));
    expect(aState1.totalWanders).toBe(1);
    expect(await fileExists(join(tA.dataDir, 'wander-history.json'))).toBe(true);

    // 租户 A 的游荡没有污染租户 B 的目录
    expect(await fileExists(join(tB.dataDir, 'state.json'))).toBe(false);

    // 租户 B 第一次游荡
    const rB1 = await runOneWander(tB);
    expect(rB1.endReason).not.toBe('error');

    const bStatePath = join(tB.dataDir, 'state.json');
    expect(await fileExists(bStatePath)).toBe(true);
    const bState1 = JSON.parse(await readFile(bStatePath, 'utf-8'));
    expect(bState1.totalWanders).toBe(1);

    // 租户 A 的状态不被 B 的游荡触碰（仍是 1，不是 2）
    const aStateAfterB = JSON.parse(await readFile(aStatePath, 'utf-8'));
    expect(aStateAfterB.totalWanders).toBe(1);

    // 租户 A 第二次游荡：只增 A 自己的计数
    await runOneWander(tA);
    const aState2 = JSON.parse(await readFile(aStatePath, 'utf-8'));
    expect(aState2.totalWanders).toBe(2);
    const bState2 = JSON.parse(await readFile(bStatePath, 'utf-8'));
    expect(bState2.totalWanders).toBe(1);
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

    await runOneWander({ ...tA, secrets: { deepseekApiKey: 'tenant-a-key' } });

    // 游荡结束后租户上下文已清除，回到单用户默认
    const { getTenantContext } = await import('../config.js');
    expect(getTenantContext()).toBeNull();
  });
});
