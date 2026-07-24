/**
 * 共享测试辅助
 *
 * 消除各测试文件间 copy-paste 的夹具与 mock 模式，提供单一来源：
 * - makeState：完整有效的 AgentState 夹具工厂
 * - mockChatCompletion / mockFetchError / restoreFetch：globalThis.fetch 打桩
 * - useTempDataDir：通过 DATA_DIR 环境变量隔离文件系统副作用
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AgentState } from '../types.js';

/**
 * 构造一个完整有效的 AgentState 测试夹具，可通过 overrides 覆盖任意字段
 */
export function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    boredom: 30,
    energy: 80,
    mood: 'curious',
    temper: 20,
    stubbornness: 30,
    lastActionTime: null,
    recentTopics: [],
    userLikes: [],
    userDislikes: [],
    agentInterests: ['科技', 'AI'],
    totalWanders: 0,
    totalSteps: 0,
    totalPushes: 0,
    consecutiveFailures: 0,
    lastHeartbeat: new Date().toISOString(),
    lastWander: null,
    lastRest: null,
    ...overrides,
  };
}

let originalFetch: typeof globalThis.fetch | undefined;

function rememberOriginalFetch(): void {
  if (originalFetch === undefined) {
    originalFetch = globalThis.fetch;
  }
}

/**
 * 用返回指定 OpenAI chat completion 内容的 mock 替换 globalThis.fetch
 * 配对 restoreFetch() 在 afterEach 恢复
 */
export function mockChatCompletion(content: string, status = 200): void {
  rememberOriginalFetch();
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'test-id',
          object: 'chat.completion',
          choices: [
            { message: { role: 'assistant', content }, finish_reason: 'stop', index: 0 },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
        { status, headers: { 'Content-Type': 'application/json' } },
      ),
    )) as unknown as typeof fetch;
}

/**
 * 让 globalThis.fetch 的下一次调用抛错（模拟网络/接口失败）
 */
export function mockFetchError(err: Error = new Error('网络错误')): void {
  rememberOriginalFetch();
  globalThis.fetch = (() => Promise.reject(err)) as unknown as typeof fetch;
}

/**
 * 恢复 globalThis.fetch 到打桩前的状态
 */
export function restoreFetch(): void {
  if (originalFetch !== undefined) {
    globalThis.fetch = originalFetch;
    originalFetch = undefined;
  }
}

/**
 * 创建唯一的临时数据目录并将 DATA_DIR 指向它，同时 chdir 进入该目录
 *
 * chdir 确保 react.ts 中硬编码的相对路径（data/wander-history.json、
 * getMemoryStore 的 data/memory）也落在临时目录内，避免污染真实 data/。
 *
 * @returns cleanup 函数，应在 afterEach 中调用以恢复 cwd、删除目录并清除环境变量
 */
export function useTempDataDir(): { dataDir: string; cleanup: () => void } {
  const dataDir = mkdtempSync(join(tmpdir(), 'cyber-stray-test-'));
  process.env.DATA_DIR = dataDir;
  const originalCwd = process.cwd();
  process.chdir(dataDir);
  return {
    dataDir,
    cleanup: () => {
      // 先切回原 cwd，再删除临时目录（否则可能因身处其中而失败）
      try {
        process.chdir(originalCwd);
      } catch {
        // 原 cwd 已不存在则忽略
      }
      rmSync(dataDir, { recursive: true, force: true });
      delete process.env.DATA_DIR;
    },
  };
}
