import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { readFile, writeFile, mkdir, readdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { loadState, saveState, updateState } from './state.js';
import { getDataPath, config } from '../config.js';
import { WanderAgent } from '../core/wander-agent.js';
import type { WanderStep } from '../types.js';
import { useTempDataDir, makeState } from '../test/helpers.js';

describe('agent/state', () => {
  let cleanup: () => void;
  let dataDir: string;

  beforeEach(() => {
    ({ cleanup, dataDir } = useTempDataDir());
  });

  afterEach(() => {
    cleanup();
  });

  test('loadState 首次：返回默认状态', async () => {
    const state = await loadState();
    expect(state.boredom).toBe(30);
    expect(state.mood).toBe('curious');
    expect(state.consecutiveFailures).toBe(0);
    expect(state.totalWanders).toBe(0);
  });

  test('save→load 往返一致', async () => {
    const custom = makeState({ mood: 'grumpy', temper: 75, totalWanders: 9 });
    await saveState(custom);

    const got = await loadState();
    expect(got.mood).toBe('grumpy');
    expect(got.temper).toBe(75);
    expect(got.totalWanders).toBe(9);
  });

  test('updateState 部分更新合并，不覆盖未涉及字段', async () => {
    await saveState(makeState({ boredom: 40, energy: 90 }));
    await updateState({ mood: 'excited' });

    const got = await loadState();
    expect(got.mood).toBe('excited');
    expect(got.boredom).toBe(40);
    expect(got.energy).toBe(90);
  });

  test('loadState 容错：非法 JSON 回退默认且不抛错', async () => {
    await writeFile(getDataPath('state.json'), '{ 这不是合法 json', 'utf-8');

    const state = await loadState();
    expect(state.boredom).toBe(30);
    expect(state.mood).toBe('curious');
  });

  // ─── #269 并发写护栏 ───

  test('#269 并发 updateState 串行合并：互不丢更新', async () => {
    await saveState(makeState({ boredom: 40 }));

    // 无锁 RMW 时四个调用各自读到同一基线，last-writer-wins 只剩一个更新
    await Promise.all([
      updateState({ boredom: 41 }),
      updateState({ energy: 91 }),
      updateState({ mood: 'grumpy' }),
      updateState({ temper: 25 }),
    ]);

    const got = await loadState();
    expect(got.boredom).toBe(41);
    expect(got.energy).toBe(91);
    expect(got.mood).toBe('grumpy');
    expect(got.temper).toBe(25);
  });

  test('#269 updateState 失败不毒化串行链：后续写照常生效', async () => {
    await saveState(makeState({}));
    // state.json 变成目录 → 读它 EISDIR → 该次 RMW 失败
    await rm(getDataPath('state.json'));
    await mkdir(getDataPath('state.json'));
    await expect(updateState({ mood: 'excited' })).rejects.toThrow();

    await rm(getDataPath('state.json'), { recursive: true });
    await updateState({ mood: 'excited' });

    const got = await loadState();
    expect(got.mood).toBe('excited');
  });

  test('#269 写入进行中并发读：永远读到完整 JSON，写完无 tmp 残留', async () => {
    await saveState(makeState({}));

    let stopped = false;
    let reads = 0;
    const reader = (async () => {
      while (!stopped) {
        const raw = await readFile(getDataPath('state.json'), 'utf-8');
        JSON.parse(raw); // 截断即抛
        reads += 1;
      }
    })();

    const writer = (async () => {
      for (let i = 0; i < 50; i++) {
        await saveState(
          makeState({ totalWanders: i, recentTopics: [`topic-${i}-${'x'.repeat(500)}`] }),
        );
      }
    })();

    await writer;
    stopped = true;
    await reader;
    expect(reads).toBeGreaterThan(0);

    const leftovers = (await readdir(dataDir)).filter((f) => f.startsWith('state.json.tmp.'));
    expect(leftovers).toEqual([]);
  });

  // flaky 隔离（负载下时序敏感：杀进程注入的落盘窗口随机）：retry 只重试
  // 该用例，不掩盖其他真实失败；限期根治 = 子进程注入窗口去随机化
  test('#269 SIGKILL 注入：杀在写入任意时刻，state.json 不截断', { timeout: 90_000, retry: 2 }, async () => {
    const tsx = fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url));
    const fixture = fileURLToPath(new URL('../test/state-kill-child.ts', import.meta.url));
    const statePath = getDataPath('state.json');
    const markerPath = join(dataDir, 'state-kill-marker');

    for (let round = 0; round < 6; round++) {
      await rm(markerPath, { force: true });
      // detached：tsx 是包装器，真实写入循环在它的 node 子进程里——
      // 必须 kill 整个进程组，否则 SIGKILL 只杀壳、写入循环变孤儿无限写盘
      const child = spawn(tsx, [fixture], {
        env: { ...process.env },
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      const killTree = (): void => {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          // 进程组已退出：忽略
        }
      };
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += String(chunk);
      });

      // 等 marker（首次 save 成功）再杀——保证每轮确实杀在写入活动中
      const deadline = Date.now() + 30_000;
      try {
        while (!existsSync(markerPath)) {
          if (Date.now() > deadline) {
            killTree();
            throw new Error(`第 ${round} 轮子进程 30s 未产生首次写入：${stderr.slice(-500)}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        killTree();
        await new Promise<void>((resolve) => child.once('exit', () => resolve()));
      } finally {
        killTree(); // 任何路径退出都补一刀进程组，杜绝孤儿
      }

      // 关键断言：任意时刻被杀，目标文件都是完整 JSON
      const raw = await readFile(statePath, 'utf-8');
      const parsed = JSON.parse(raw) as { totalWanders: number };
      expect(parsed.totalWanders).toBeGreaterThanOrEqual(0);
    }
  });

  test('#269 游荡写 wander-history × 日记并发读：读者永远见完整 JSON', async () => {
    const agent = new WanderAgent(config);
    const appendHistory = (
      agent as unknown as { appendWanderHistory: (steps: WanderStep[]) => Promise<void> }
    ).appendWanderHistory.bind(agent);
    const historyPath = getDataPath('wander-history.json');

    const step = (n: number): WanderStep => ({
      timestamp: new Date().toISOString(),
      tool: 'search_web',
      thought: `搜索(free): 测试话题-${n}-${'y'.repeat(300)}`,
    });
    await appendHistory([step(-1)]);

    let stopped = false;
    let reads = 0;
    const diaryReader = (async () => {
      while (!stopped) {
        const raw = await readFile(historyPath, 'utf-8');
        const parsed = JSON.parse(raw) as WanderStep[]; // 日记按天取步骤，截断即抛
        expect(Array.isArray(parsed)).toBe(true);
        reads += 1;
      }
    })();

    for (let i = 0; i < 30; i++) {
      await appendHistory([step(i)]);
    }

    stopped = true;
    await diaryReader;
    expect(reads).toBeGreaterThan(0);

    const final = JSON.parse(await readFile(historyPath, 'utf-8')) as WanderStep[];
    expect(final).toHaveLength(31);

    const leftovers = (await readdir(dataDir)).filter((f) => f.startsWith('wander-history.json.tmp.'));
    expect(leftovers).toEqual([]);
  });
});
