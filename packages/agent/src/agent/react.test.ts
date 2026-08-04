import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

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
import { WanderAgent } from '../core/wander-agent.js';
import { loadState } from './state.js';
import { ToolManager } from '../tools/tool-manager.js';
import { getLLMStats, resetLLMStats } from '../llm/stats.js';
import { config } from '../config.js';
import {
  useTempDataDir,
  makeState,
  restoreFetch,
} from '../test/helpers.js';
import { existsSync } from 'fs';
import { join } from 'path';

function mockGenerateText(
  impl: (opts: {
    onStepFinish?: (event: { stepNumber: number; usage?: Record<string, number> }) => void;
  }) => Promise<void>,
): void {
  (generateText as ReturnType<typeof vi.fn>).mockImplementation(impl);
}

describe('WanderAgent.wander (loop + post-processing)', () => {
  let cleanup: () => void;
  const savedKey = process.env.DEEPSEEK_API_KEY;
  let agent: WanderAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ cleanup } = useTempDataDir());
    process.env.DEEPSEEK_API_KEY = 'test-key';
    ToolManager.reset();
    resetLLMStats();
    agent = new WanderAgent(config);
  });

  afterEach(() => {
    cleanup();
    restoreFetch();
    if (savedKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = savedKey;
    }
  });

  test('config.generateTextMaxRetries 键自包含：types.ts/config.ts/agent-config.json 三处一致写入', () => {
    expect(config.generateTextMaxRetries).toBeDefined();
    expect(config.generateTextMaxRetries).toBe(1);
  });

  test('D-11 按步计数：mock generateText 触发多个 onStepFinish 后 getLLMStats().calls > 1', async () => {
    mockGenerateText(async (opts) => {
      for (let i = 0; i < 3; i++) {
        opts.onStepFinish?.({
          stepNumber: i,
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        });
      }
    });

    const result = await agent.wander(makeState());

    expect(getLLMStats().calls).toBeGreaterThan(1);
    expect(getLLMStats().calls).toBe(3);
    expect(result.endReason).not.toBe('error');
  }, 15000);

  test('A1 durationMs 用 Date.now() 差值：成功步后 getLLMStats().totalMs > 0', async () => {
    // Mock Date.now to advance deterministically (no real timers)
    let now = 1000;
    const originalNow = Date.now;
    vi.spyOn(Date, 'now').mockImplementation(() => { now += 5; return now; });

    mockGenerateText(async (opts) => {
      opts.onStepFinish?.({
        stepNumber: 0,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      });
    });

    await agent.wander(makeState());

    expect(getLLMStats().totalMs).toBeGreaterThan(0);
    expect(getLLMStats().totalTokens).toBe(15);

    vi.restoreAllMocks();
    Date.now = originalNow;
  });

  test('D-05/MEM-03 空游荡不推送：mock generateText 不触发任何工具 → speakCount=0 且无推送历史文件', async () => {
    mockGenerateText(async () => {
      // empty wander
    });

    const result = await agent.wander(makeState());

    expect(result.spokeTimes).toBe(0);
    const today = new Date().toISOString().slice(0, 10);
    const speakHistoryPath = join('data', 'history', `speaks-${today}.jsonl`);
    expect(existsSync(speakHistoryPath)).toBe(false);
  });

  test('D-10 失败重试：generateText 抛错 → endReason=error 且 consecutiveFailures 递增', async () => {
    mockGenerateText(async () => {
      throw new Error('LLM 调用失败');
    });

    const startState = makeState({ consecutiveFailures: 2 });
    const result = await agent.wander(startState);

    expect(result.endReason).toBe('error');

    const updated = await loadState();
    expect(updated.consecutiveFailures).toBe(3);
    // F11 + CR-06：失败的游荡不计入 totalWanders（早返，不走 postWander）
    expect(updated.totalWanders).toBe(startState.totalWanders);
  });

  test('Pitfall 1 自愈：onStepFinish 回调内 usage=undefined → 主流程不中断', async () => {
    mockGenerateText(async (opts) => {
      opts.onStepFinish?.({ stepNumber: 0, usage: undefined });
    });

    const result = await agent.wander(makeState());
    expect(result).toBeDefined();
    expect(result.endReason).not.toBe('error');
  });
});
