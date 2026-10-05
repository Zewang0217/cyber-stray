import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateText } from 'ai';
import { wanderLoop, type WanderLoopInput } from './wander-loop.js';
import { makeState, useTempDataDir } from '../test/helpers.js';
import { localDateKey } from '../usage/usage.js';

vi.mock('ai', () => ({ generateText: vi.fn(), stepCountIs: vi.fn(), hasToolCall: vi.fn() }));

type StepHook = (step: { stepNumber: number; usage: {
  inputTokens: number; outputTokens: number; totalTokens: number;
}; toolCalls: [] }) => Promise<void>;

function input(): WanderLoopInput {
  const state = makeState();
  return {
    state, config: { maxSteps: 5, temperature: 0.4, llmModel: 'deepseek-chat', generateTextMaxRetries: 1 },
    systemPrompt: 'test', userPrompt: 'test', tools: {}, emit: () => {}, traceId: 'test',
    model: {} as WanderLoopInput['model'],
    toolCtx: { state, traceId: 'test', stepCount: 0, wanderHistory: [], visitedUrls: [],
      spokeTimes: 0, pendingFeedbackCount: 0, endReason: 'max_steps', startTime: Date.now(), searchQueries: [] },
  };
}

describe('游荡逐步用量', () => {
  let dataDir: string;
  let cleanup: () => void;
  beforeEach(() => { ({ dataDir, cleanup } = useTempDataDir()); vi.resetAllMocks(); });
  afterEach(() => cleanup());

  test('未知 LLM 价格在第一次模型调用前明确拒绝', async () => {
    const args = input();
    args.config.llmModel = 'unpriced-llm';
    await expect(wanderLoop(args)).rejects.toThrow('未知模型单价');
    expect(generateText).not.toHaveBeenCalled();
  });

  test('多步成功记录全部用量，失败尝试已完成的步骤也保留且不重复', async () => {
    let attempt = 0;
    vi.mocked(generateText).mockImplementation(async (options) => {
      const step = options.onStepFinish as unknown as StepHook;
      await step({ stepNumber: 0, usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 }, toolCalls: [] });
      if (attempt++ === 0) throw new Error('provider interrupted after first step');
      await step({ stepNumber: 1, usage: { inputTokens: 20, outputTokens: 3, totalTokens: 23 }, toolCalls: [] });
      return { text: '', steps: [], toolCalls: [], usage: { inputTokens: 20, outputTokens: 3 } } as never;
    });

    expect((await wanderLoop(input())).endReason).not.toBe('error');
    const rows = (await readFile(join(dataDir, 'usage', `usage-${localDateKey()}.jsonl`), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line));
    expect(rows.map((row) => [row.inputTokens, row.outputTokens])).toEqual([[10, 2], [10, 2], [20, 3]]);
  });

  test('用量写入失败明确抛错，并且停止整轮重试', async () => {
    await writeFile(join(dataDir, 'usage'), 'blocked directory');
    vi.mocked(generateText).mockImplementation(async (options) => {
      await (options.onStepFinish as unknown as StepHook)({ stepNumber: 0,
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 }, toolCalls: [] });
      return { text: '', steps: [], toolCalls: [] } as never;
    });
    await expect(wanderLoop(input())).rejects.toThrow('用量记账失败');
    expect(generateText).toHaveBeenCalledTimes(1);
  });
});
