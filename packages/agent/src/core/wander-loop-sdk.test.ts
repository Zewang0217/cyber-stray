import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import { wanderLoop, type WanderLoopInput } from './wander-loop.js';
import { makeState, useTempDataDir } from '../test/helpers.js';

describe('真实 AI SDK 计费门禁', () => {
  let dataDir: string;
  let cleanup: () => void;
  beforeEach(() => { ({ dataDir, cleanup } = useTempDataDir()); });
  afterEach(() => cleanup());

  test.each([false, true])('SDK 吞掉 onStepFinish 异常后仍停止，存在后续工具步骤=%s', async (hasNextStep) => {
    await writeFile(join(dataDir, 'usage'), 'blocked');
    const model = new MockLanguageModelV3({
      modelId: 'deepseek-chat',
      doGenerate: async () => ({
        content: hasNextStep
          ? [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'observe', input: '{}' }]
          : [{ type: 'text', text: 'done' }],
        finishReason: { unified: hasNextStep ? 'tool-calls' : 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 2, text: 2, reasoning: 0 },
        },
        warnings: [],
      }),
    });
    const state = makeState();
    const input: WanderLoopInput = {
      state, model,
      config: { maxSteps: 5, temperature: 0.4, llmModel: model.modelId, generateTextMaxRetries: 1 },
      systemPrompt: 'test', userPrompt: 'test', traceId: 'sdk-test', emit: () => {},
      tools: { observe: tool({ inputSchema: z.object({}), execute: async () => 'observed' }) },
      toolCtx: { state, traceId: 'sdk-test', stepCount: 0, wanderHistory: [], visitedUrls: [],
        spokeTimes: 0, pendingFeedbackCount: 0, endReason: 'max_steps', startTime: Date.now(), searchQueries: [] },
    };
    await expect(wanderLoop(input)).rejects.toThrow('用量记账失败');
    expect(model.doGenerateCalls).toHaveLength(1);
  });
});
