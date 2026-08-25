/**
 * pet-sheet.py 封装测试（#94）：fake spawn，断言参数构造与输出解析
 *
 * 契约：cells 切分带 --report 并解析空格数；缺状态文件 → 抛错（禁兜底）；
 * 概念归一/参考图压平按输出名落盘。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createSplitter, type SpawnLike } from './splitter.js';

describe('createSplitter.splitGrid', () => {
  let tmp: string;
  let seenArgs: string[][];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cp-petgen-split-'));
    seenArgs = [];
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function fakeSpawn(stdout: string, exitCode = 0): SpawnLike {
    return (async (_cmd, args, _opts) => {
      seenArgs.push(args);
      return { exitCode, stdout, stderr: '' };
    }) as SpawnLike;
  }

  it('构造 --cells --cols 2 --states 参数', async () => {
    const splitter = createSplitter({ spawnFn: fakeSpawn('') });
    const grid = join(tmp, 'grid.png');
    const outDir = join(tmp, 'states');
    await expect(
      splitter.splitGrid(grid, ['idle', 'walk', 'joy'], { cols: 2, outDir }),
    ).rejects.toThrow(/无 JSON 输出/);
    const args = seenArgs[0];
    expect(args).toEqual([
      expect.stringContaining('pet-sheet.py'),
      grid,
      '--grid',
      '--cells',
      '--cols',
      '2',
      '--states',
      'idle',
      'walk',
      'joy',
      '--out',
      outDir,
      '--report',
    ]);
  });

  it('解析报告：空格跳过 + 状态文件映射', async () => {
    const splitter = createSplitter({
      spawnFn: fakeSpawn(
        'idle: 1 frame\nwalk: 1 frame\njoy: 空格跳过\n{"cells": 4, "emptyCells": 1, "states": {"idle": "ok", "walk": "ok", "joy": "empty"}}\ndone → /x',
      ),
    });
    const outDir = join(tmp, 'states');
    const { files, emptyCells } = await splitter.splitGrid(join(tmp, 'g.png'), ['idle', 'walk', 'joy'], {
      cols: 2,
      outDir,
    });
    expect(files).toEqual({ idle: join(outDir, 'idle.png'), walk: join(outDir, 'walk.png') });
    expect(emptyCells).toBe(1);
  });

  it('脚本失败（exit 非 0）→ 抛错带 stderr 尾巴', async () => {
    const splitter = createSplitter({
      spawnFn: fakeSpawn('', 1),
    });
    await expect(
      splitter.splitGrid(join(tmp, 'g.png'), ['idle'], { cols: 1, outDir: tmp }),
    ).rejects.toThrow(/exit 1/);
  });

  it('报告缺状态（模型画漏）→ 抛错（禁兜底不静默跳过）', async () => {
    const splitter = createSplitter({
      spawnFn: fakeSpawn(
        '{"cells": 2, "emptyCells": 0, "states": {"idle": "ok", "walk": "ok"}}',
      ),
    });
    await expect(
      splitter.splitGrid(join(tmp, 'g.png'), ['idle', 'walk', 'joy'], { cols: 2, outDir: tmp }),
    ).rejects.toThrow(/缺状态文件: joy/);
  });
});

describe('createSplitter 概念归一 / 参考图压平', () => {
  let tmp: string;
  let seenArgs: string[][];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cp-petgen-split2-'));
    seenArgs = [];
    writeFileSync(join(tmp, 'concept-raw.png'), 'fake-png');
    writeFileSync(join(tmp, 'concept.png'), 'fake-png');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('normalizeConcept：--single --frame 512，输出改名到 outPath', async () => {
    const splitter = createSplitter({
      spawnFn: (async (_cmd, args, _opts) => {
        seenArgs.push(args);
        return { exitCode: 0, stdout: 'done → /x', stderr: '' };
      }) as SpawnLike,
    });
    const outPath = join(tmp, 'concept.png'); // 与脚本输出同名（同 stem）
    const result = await splitter.normalizeConcept(join(tmp, 'concept-raw.png'), outPath, 512);
    expect(result).toBe(outPath);
    const args = seenArgs[0]!;
    expect(args).toContain('--single');
    expect(args).toContain('--frame');
    expect(args).toContain('512');
  });

  it('flattenReference：--flatten，输出 .jpg', async () => {
    const splitter = createSplitter({
      spawnFn: (async (_cmd, args, _opts) => {
        seenArgs.push(args);
        // 脚本产出 <stem>.jpg —— fake 真实落盘供 rename 校验
        writeFileSync(join(tmp, 'concept.jpg'), 'fake-jpg');
        return { exitCode: 0, stdout: 'done → /x', stderr: '' };
      }) as SpawnLike,
    });
    const outPath = join(tmp, 'reference.jpg');
    const result = await splitter.flattenReference(join(tmp, 'concept.png'), outPath, 384);
    expect(result).toBe(outPath);
    const args = seenArgs[0]!;
    expect(args).toContain('--flatten');
    expect(args).toContain('384');
  });
});
