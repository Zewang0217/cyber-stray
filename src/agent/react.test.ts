import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { runAgentLoop, _resetReactModuleState } from './react.js';
import { loadState } from './state.js';
import { ToolManager } from '../tools/tool-manager.js';
import { getLLMStats } from '../llm/stats.js';
import { useTempDataDir, makeState, mockFetchError, restoreFetch } from '../test/helpers.js';

describe('runAgentLoop', () => {
  let cleanup: () => void;
  const savedKey = process.env.DEEPSEEK_API_KEY;

  beforeEach(() => {
    ({ cleanup } = useTempDataDir());
    process.env.DEEPSEEK_API_KEY = 'test-key';
    _resetReactModuleState();
    ToolManager.reset();
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

  test('LLM 调用失败：endReason=error、consecutiveFailures 递增、统计非零', async () => {
    mockFetchError();
    const startState = makeState({ consecutiveFailures: 2 });

    const result = await runAgentLoop(startState);

    expect(result.endReason).toBe('error');

    // 验证 Bug1 修复：调用失败也计入统计（startLLMCall/finally endLLMCall），不再恒为 0
    expect(getLLMStats().calls).toBeGreaterThanOrEqual(1);

    // 错误路径下 consecutiveFailures +1
    const updated = await loadState();
    expect(updated.consecutiveFailures).toBe(3);
  });
});
