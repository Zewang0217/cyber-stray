/**
 * 共享测试辅助
 *
 * 消除各测试文件间 copy-paste 的夹具与 mock 模式，提供单一来源：
 * - makeState：完整有效的 AgentState 夹具工厂
 * - mockChatCompletion / mockFetchError / restoreFetch：globalThis.fetch 打桩
 * - useTempDataDir：通过 DATA_DIR 环境变量隔离文件系统副作用
 */

import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AgentState } from '../types.js';
import { _resetMemoryStore } from '../memory/long-term/index.js';
import { _resetMemoryIndex } from '../memory/long-term/memory-index.js';
import {
  _resetInterestGraphCache,
  InterestGraph,
  type InterestGraphConfig,
} from '../memory/interest-graph.js';
import { INTEREST_DECAY_LAMBDA } from '../memory/interest-constants.js';

// 兴趣图谱测试夹具（S2 #151，signal / profile-summary 测试共享）

/** 图谱测试配置：minInterestCount=5 保证冷启动期 addInterest 不被 novelty 预算钳制 */
export const INTEREST_TEST_CONFIG: InterestGraphConfig = {
  decayLambda: INTEREST_DECAY_LAMBDA,
  maxWeight: 0.8,
  minInterestCount: 5,
  maxInterestCount: 20,
  noveltyBudget: 0.5,
  defaultSeeds: [],
  minWeight: 0.01,
};

let graphSeq = 0;

/**
 * 独立临时路径的空 InterestGraph（构造不要求文件存在，persist 时才建）。
 * 信号数学测试与摘要渲染测试共享，避免配置漂移。
 */
export function makeTestInterestGraph(
  config: InterestGraphConfig = INTEREST_TEST_CONFIG,
): InterestGraph {
  const dir = join(tmpdir(), `s2-graph-${process.pid}-${Date.now()}-${graphSeq++}`);
  return new InterestGraph(join(dir, 'interests.json'), config);
}

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
 * 创建唯一的临时数据目录并将 DATA_DIR 指向它，同时 chdir 进入其父目录
 *
 * DATA_DIR 指向 `<root>/data` 而 cwd 指向 `<root>`，让两条路径解析基准合流：
 * 走 getDataPath 的模块与测试里写死的 `data/xxx` 字面量夹具落在同一处，
 * 都在临时目录内，不污染真实的 packages/agent/data/。
 *
 * @returns dataDir 为数据目录本身，root 为其父目录（即 cwd）；
 *          cleanup 应在 afterEach 中调用以恢复 cwd、删除目录并清除环境变量
 */
export function useTempDataDir(): { dataDir: string; root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'cyber-stray-test-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir, { recursive: true });
  process.env.DATA_DIR = dataDir;
  const originalCwd = process.cwd();
  process.chdir(root);
  // 这些单例在构造时把 DATA_DIR 解析成绝对路径，不重置会继续指向上一个临时目录
  resetPathBoundSingletons();
  return {
    dataDir,
    root,
    cleanup: () => {
      // 先切回原 cwd，再删除临时目录（否则可能因身处其中而失败）
      try {
        process.chdir(originalCwd);
      } catch {
        // 原 cwd 已不存在则忽略
      }
      rmSync(root, { recursive: true, force: true });
      delete process.env.DATA_DIR;
      resetPathBoundSingletons();
    },
  };
}

/** 重置所有把数据目录固化在实例里的模块级单例 */
function resetPathBoundSingletons(): void {
  _resetMemoryStore();
  _resetMemoryIndex();
  _resetInterestGraphCache();
}
