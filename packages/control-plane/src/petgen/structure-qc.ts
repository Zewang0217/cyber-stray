/**
 * 结构质检封装（#94 两层质检的结构层）——qc-structure.py
 *
 * 校验成品状态帧满足素材契约：256x256 / 透明底 / 内容占比 ≥20%
 * （ADR-0001 + spike §5）。脚本输出单行 JSON，退出码 0=全过。
 * spawn 可注入（测试 fake），路径经 import.meta.url 仓库内锚定。
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import type { PetStateId } from '@cyber-stray/shared/pet';
import type { StateQcResult, StructureQc } from './types.js';
import type { SpawnLike } from './splitter.js';

/** qc-structure.py 绝对路径（本包 scripts/ 下；import.meta.url 在 src/petgen/，需上跳两级） */
const QC_STRUCTURE_PY = fileURLToPath(
  new URL('../../scripts/qc-structure.py', import.meta.url),
);

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
    stderr += chunk;
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

export interface StructureQcOptions {
  pythonCmd?: string;
  timeoutMs?: number;
  spawnFn?: SpawnLike;
}

/** 创建结构质检（真实实现；测试传 spawnFn 注入 fake） */
export function createStructureQc(opts: StructureQcOptions = {}): StructureQc {
  const pythonCmd = opts.pythonCmd ?? 'python3';
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const spawnFn = opts.spawnFn ?? realSpawn;

  return {
    async inspect(statesDir, states, opts) {
      const frame = opts?.frame ?? 256;
      const frames = opts?.frames ?? {};
      // 帧数 >1 的状态以 name:frames 形式传给脚本（横排帧条按 frames×frame 宽校验）
      const tokens = states.map((s) => {
        const n = frames[s];
        return n && n > 1 ? `${s}:${n}` : s;
      });
      const { exitCode, stdout, stderr } = await spawnFn(
        pythonCmd,
        [QC_STRUCTURE_PY, statesDir, ...tokens, '--frame', String(frame)],
        { timeoutMs },
      );
      // 脚本已把单个失败态输出为 ok:false 的 JSON；非 JSON 输出 / 崩溃 → 显式抛
      if (!stdout.trim()) {
        throw new Error(`qc-structure.py 无输出（exit ${exitCode}）：${stderr.trim().slice(-300)}`);
      }
      // 脚本输出形状：{ ok, states: { <state>: { ok, width, height, hasAlpha, contentRatio, reason? } } }
      // （注意是 ok/reason——映射到 StateQcResult 的 pass/issues 在下方，E2E 抓过字段名错位的祖传 bug）
      let parsed: {
        ok: boolean;
        states: Record<string, { ok?: unknown; reason?: unknown }>;
      };
      try {
        parsed = JSON.parse(stdout.trim().split('\n').filter(Boolean).at(-1) ?? '{}') as typeof parsed;
      } catch {
        throw new Error(`qc-structure.py 输出非 JSON：${stdout.trim().slice(-300)}`);
      }
      if (typeof parsed.ok !== 'boolean' || typeof parsed.states !== 'object' || parsed.states === null) {
        throw new Error(`qc-structure.py 输出缺字段：${stdout.trim().slice(-300)}`);
      }
      // 脚本未上报的状态（漏检）→ 显式失败（禁兜底）
      const result = {} as Record<PetStateId, StateQcResult>;
      for (const state of states) {
        const r = parsed.states[state];
        if (!r || typeof r.ok !== 'boolean') {
          result[state] = { pass: false, issues: ['结构质检未上报该状态'] };
          continue;
        }
        const ok = r.ok as boolean;
        result[state] = { pass: ok, issues: ok ? [] : typeof r.reason === 'string' ? [r.reason] : ['结构质检未给出原因'] };
      }
      return result;
    },
  };
}
