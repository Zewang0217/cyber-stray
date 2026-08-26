/**
 * 优雅停机编排测试（#138 / ADR-0008）
 *
 * 契约（issue #138 Testing Decisions——唯一新增单测面）：
 * - 停止信号后先停派发（stopDispatch 先于一切），调度器不再拉起新游荡
 *   （"不再派发"的调度器语义见 scheduler.test.ts 的 stop 测试）
 * - 在飞游荡在预算内收口 → 卸除分发 → 退出（exit 0，不强制杀）
 * - 预算耗尽 → 按既定策略强制终止在飞 worker → 卸除分发 → 退出，
 *   编排不留悬挂句柄（编排 Promise 落定、预算定时器已清、无后续动作）
 * - drain 未成功收口（拒绝）视同未收口：强制终止兜底，不无限挂起
 *
 * 接缝：stopDispatch / drain / forceKill / detach / exit 全部注入，
 * 预算用短真实定时器（不依赖真实 90s 等待）。
 */

import { describe, it, expect } from 'vitest';
import { runGracefulShutdown, type GracefulShutdownDeps } from './graceful-shutdown.js';

function makeDeps(overrides: Partial<GracefulShutdownDeps> = {}) {
  const calls: string[] = [];
  const deps: GracefulShutdownDeps = {
    budgetMs: 30,
    stopDispatch: () => void calls.push('stopDispatch'),
    drain: async () => void calls.push('drain'),
    forceKill: () => void calls.push('forceKill'),
    detach: () => void calls.push('detach'),
    exit: (code) => void calls.push(`exit:${code}`),
    ...overrides,
  };
  return { deps, calls };
}

describe('优雅停机编排', () => {
  it('停止信号后先停派发，在飞在预算内收口后卸分发退出（不强制杀）', async () => {
    const { deps, calls } = makeDeps();

    await runGracefulShutdown(deps);

    expect(calls).toEqual(['stopDispatch', 'drain', 'detach', 'exit:0']);
    expect(calls).not.toContain('forceKill');
  });

  it('drain 未成功收口（拒绝）→ 强制终止兜底后卸分发退出，不无限挂起', async () => {
    const { deps, calls } = makeDeps({
      drain: async () => {
        calls.push('drain');
        throw new Error('drain 内部错误');
      },
    });

    await runGracefulShutdown(deps);

    expect(calls).toEqual(['stopDispatch', 'drain', 'forceKill', 'detach', 'exit:0']);
  });

  it('预算耗尽：强制终止在飞 worker 后卸分发退出，编排不留悬挂句柄', async () => {
    let releaseDrain: () => void = () => {};
    const { deps, calls } = makeDeps({
      drain: () =>
        new Promise<void>((resolve) => {
          calls.push('drain');
          releaseDrain = resolve;
        }),
    });

    await runGracefulShutdown(deps); // 预算 30ms 后落定，无需真实 90s

    expect(calls).toEqual(['stopDispatch', 'drain', 'forceKill', 'detach', 'exit:0']);

    // 句柄收尾：被放弃的 drain 之后落定，也不得再触发任何动作（exit 恰一次）
    releaseDrain();
    await Promise.resolve();
    expect(calls).toEqual(['stopDispatch', 'drain', 'forceKill', 'detach', 'exit:0']);
  });
});
