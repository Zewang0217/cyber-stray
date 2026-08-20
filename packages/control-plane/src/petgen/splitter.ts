/**
 * pet-sheet.py 封装（#94）：网格切分 / 概念图归一 / 参考图压平
 *
 * 脚本复用 packages/web/scripts/pet-sheet.py（spike #89 产物，含 cells 模式），
 * 路径经 import.meta.url 仓库内锚定——不依赖 cwd。spawn 可注入（测试 fake）。
 * 脚本退出码非 0 / 输出缺文件 → 显式抛错（禁兜底）。
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { rename } from 'fs/promises';
import { join, dirname, basename, extname } from 'path';
import type { PetStateId } from '@cyber-stray/shared/pet';
import type { Splitter } from './types.js';

/** pet-sheet.py 绝对路径（仓库内锚定，与 worker-runner AGENT_CLI 同款） */
const PET_SHEET_PY = fileURLToPath(
  new URL('../../../../web/scripts/pet-sheet.py', import.meta.url),
);

/** 注入式 spawn（测试 fake；真实实现见 realSpawn） */
export type SpawnLike = (
  cmd: string,
  args: string[],
  opts: { timeoutMs: number },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

/** stderr 累积上限（64 KiB——排障尾巴足够，防长命控制面无界增长） */
const STDERR_CAP_BYTES = 64 * 1024;

const realSpawn: SpawnLike = (cmd, args, { timeoutMs }) => {
  const { promise, resolve, reject } = Promise.withResolvers<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>();
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf-8');
  child.stderr.setEncoding('utf-8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length < STDERR_CAP_BYTES) stderr += chunk;
  });
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
  }, timeoutMs);
  child.on('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    resolve({ exitCode: code ?? -1, stdout, stderr });
  });
  return promise;
};

export interface SplitterOptions {
  /** python 可执行（默认 python3；测试可注入 fake spawn 后任意值） */
  pythonCmd?: string;
  timeoutMs?: number;
  spawnFn?: SpawnLike;
}

/** 运行脚本并断言成功；失败抛错（含 stderr 尾巴） */
async function runScript(
  spawnFn: SpawnLike,
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  const { exitCode, stdout, stderr } = await spawnFn(cmd, args, { timeoutMs });
  if (exitCode !== 0) {
    const tail = stderr.trim().slice(-500);
    throw new Error(`pet-sheet.py 失败（exit ${exitCode}）：${tail || stdout.trim().slice(-500)}`);
  }
  return stdout;
}

/** 解析 --report 输出的 JSON 行（末尾最后一个 JSON 对象） */
function parseReport(
  stdout: string,
): { cells: number; emptyCells: number; states: Record<string, string> } {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i] ?? '') as {
        cells?: number;
        emptyCells?: number;
        states?: Record<string, string>;
      };
      if (
        typeof parsed.cells === 'number' &&
        typeof parsed.emptyCells === 'number' &&
        typeof parsed.states === 'object' &&
        parsed.states !== null
      ) {
        return { cells: parsed.cells, emptyCells: parsed.emptyCells, states: parsed.states };
      }
    } catch {
      // 继续往前找（"done →" 行之前是 JSON 行）
    }
  }
  throw new Error(`pet-sheet.py --report 无 JSON 输出：${stdout.trim().slice(-300)}`);
}

/** 创建切分/归一封装（真实实现；测试传 spawnFn 注入 fake） */
export function createSplitter(opts: SplitterOptions = {}): Splitter {
  const pythonCmd = opts.pythonCmd ?? 'python3';
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const spawnFn = opts.spawnFn ?? realSpawn;

  return {
    async splitGrid(gridPath, states, { cols, outDir }) {
      const stdout = await runScript(
        spawnFn,
        pythonCmd,
        [
          PET_SHEET_PY,
          gridPath,
          '--grid',
          '--cells',
          '--cols',
          String(cols),
          '--states',
          ...states,
          '--out',
          outDir,
          '--report',
        ],
        timeoutMs,
      );
      const report = parseReport(stdout);
      const files: Record<PetStateId, string> = {} as Record<PetStateId, string>;
      const missing: PetStateId[] = [];
      for (const state of states) {
        const status = report.states[state];
        if (status === 'ok') {
          files[state] = join(outDir, `${state}.png`);
        } else if (status !== 'empty') {
          // 脚本未上报该状态（模型画漏/切分丢失）→ 缺文件，禁兜底
          missing.push(state);
        }
      }
      if (missing.length > 0) {
        throw new Error(`切分缺状态文件: ${missing.join(', ')}（输出: ${stdout.trim().slice(-300)}）`);
      }
      return { files, emptyCells: report.emptyCells };
    },

    async normalizeConcept(srcPath, outPath, frame) {
      const outDir = dirname(outPath);
      await runScript(
        spawnFn,
        pythonCmd,
        [PET_SHEET_PY, srcPath, '--single', '--frame', String(frame), '--out', outDir],
        timeoutMs,
      );
      // 脚本按输入名输出 <stem>.png；改名到期望路径（通常同名）
      const produced = join(outDir, `${basename(srcPath, extname(srcPath))}.png`);
      if (produced !== outPath) {
        await rename(produced, outPath);
      }
      return outPath;
    },

    async flattenReference(srcPath, outPath, frame) {
      const outDir = dirname(outPath);
      await runScript(
        spawnFn,
        pythonCmd,
        [PET_SHEET_PY, srcPath, '--flatten', '--frame', String(frame), '--out', outDir],
        timeoutMs,
      );
      const produced = join(outDir, `${basename(srcPath, extname(srcPath))}.jpg`);
      if (produced !== outPath) {
        await rename(produced, outPath);
      }
      return outPath;
    },
  };
}
