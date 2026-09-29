/**
 * 结构质检封装测试：fake spawn 返回 qc-structure.py 的**真实输出形状**
 * （ok/width/hasAlpha/contentRatio/reason——不是 StateQcResult 的 pass/issues）。
 *
 * 背景：E2E 抓到祖传字段错位——封装读 r.pass，脚本输出 r.ok，所有状态恒被
 * 误判「未上报」，经典路径结构质检在生产从未真正工作（processor 测试全程
 * mock 结构质检，故未暴露）。本测试锁死映射，防再次回归。
 */

import { describe, it, expect } from 'vitest';
import { createStructureQc } from './structure-qc.js';
import type { SpawnLike } from './splitter.js';

/** qc-structure.py 真实输出形状（单行 JSON；ok:false 的状态带 reason） */
const REAL_SCRIPT_OUTPUT = JSON.stringify({
  ok: false,
  states: {
    idle: { ok: true, width: 256, height: 64, hasAlpha: true, contentRatio: 0.43 },
    walk: {
      ok: false, width: 256, height: 64, hasAlpha: true, contentRatio: 0.18,
      reason: '内容占比 18.2% < 20%(可能被切断或整格空白)',
    },
  },
});

describe('createStructureQc 映射（真实脚本形状 ok/reason → StateQcResult）', () => {
  it('ok:true → pass:true；ok:false → pass:false + reason 进 issues', async () => {
    const spawnFn = (async (_cmd, _args, _opts) => ({
      exitCode: 1,
      stdout: REAL_SCRIPT_OUTPUT,
      stderr: '',
    })) as SpawnLike;
    const qc = createStructureQc({ spawnFn });
    const r = await qc.inspect('/x', ['idle', 'walk'], { frame: 64, frames: { idle: 4, walk: 4 } });
    expect(r.idle).toEqual({ pass: true, issues: [] });
    expect(r.walk?.pass).toBe(false);
    expect(r.walk?.issues).toEqual(['内容占比 18.2% < 20%(可能被切断或整格空白)']);
  });

  it('参数构造：帧数 >1 以 name:frames 传递，--frame 透传', async () => {
    let seen: string[] = [];
    const spawnFn = (async (_cmd, args, _opts) => {
      seen = args as string[];
      return { exitCode: 0, stdout: REAL_SCRIPT_OUTPUT, stderr: '' };
    }) as SpawnLike;
    const qc = createStructureQc({ spawnFn });
    await qc.inspect('/x', ['idle', 'walk'], { frame: 64, frames: { idle: 4, walk: 4 } });
    expect(seen).toContain('idle:4');
    expect(seen).toContain('walk:4');
    expect(seen).toContain('--frame');
    expect(seen).toContain('64');
  });

  it('脚本未上报的状态 → 显式失败（禁兜底）', async () => {
    const spawnFn = (async (_cmd, _args, _opts) => ({
      exitCode: 0,
      stdout: JSON.stringify({ ok: true, states: {} }),
      stderr: '',
    })) as SpawnLike;
    const qc = createStructureQc({ spawnFn });
    const r = await qc.inspect('/x', ['idle']);
    expect(r.idle?.pass).toBe(false);
    expect(r.idle?.issues).toEqual(['结构质检未上报该状态']);
  });
});
