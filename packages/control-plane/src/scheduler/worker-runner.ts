/**
 * worker-runner — 真实短命 worker 拉起（S5）
 *
 * 每次游荡 = 一个子进程：agent 包 CLI（默认 bun，可 CP_WORKER_CMD 覆盖）
 * `bun packages/agent/src/worker/cli.ts --tenant <id> --data-dir <dir>`，
 * 跑完退出（无常驻宠物进程）。
 *
 * per-tenant secrets：S4 store 解密 → 临时 JSON（0600，跑完即删）→
 * `--secrets-file` 注入；无 secrets 不传（worker 回退进程 env 的平台 key）。
 * 密钥只在磁盘上以密文（dek.enc/DB）和这段临时明文文件存在，进程退出即清；
 * 控制面启动时清扫上次崩溃残留的临时文件（sweepStaleSecretFiles）。
 */

import { spawn } from 'child_process';
import { readdir, rm } from 'fs/promises';
import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { StringDecoder } from 'string_decoder';
import { fileURLToPath } from 'url';
import { openTenantSecrets, type TenantSecretsStore } from '../secrets/tenant-secrets.js';
import { writeSecretsFile, resolveAgentSecrets } from '../secrets/worker-secrets.js';
import type { WanderStatsReport } from '@cyber-stray/shared/pet-stats';
import type { WorkerJob, WorkerResult, WorkerRunner } from './scheduler.js';

/** agent 包 CLI 绝对路径（仓库内锚定，无硬编码全路径） */
const AGENT_CLI = fileURLToPath(
  new URL('../../../agent/src/worker/cli.ts', import.meta.url),
);

// ─── worker 运行日志落盘（#122）─────────────────────────────────────
// worker stdout/stderr 全量按「租户+日期」落盘，失败时错误可查（原实现只
// 在非零退出时打印 2KB 尾巴，运行中错误不可见）。best-effort：日志失败
// 静默丢弃，绝不打断 worker 与调度。

/** worker 日志保留天数（启动清理；防无界磁盘占用） */
export const WORKER_LOG_RETENTION_DAYS = 14;
/** 单文件日志上限（超限停止追加 + 一次性截断标记） */
export const MAX_WORKER_LOG_BYTES = 10 * 1024 * 1024;

const WORKER_LOG_SUBDIR = join('logs', 'workers');
const truncatedFiles = new Set<string>();

/** 本地日期键（YYYY-MM-DD；日志按天分文件） */
export function logDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** worker 日志文件路径（kind: worker|diary；按租户+日期） */
export function workerLogPath(dataDir: string, kind: 'worker' | 'diary', tenantId: string): string {
  return join(dataDir, WORKER_LOG_SUBDIR, `${kind}-${tenantId}-${logDateKey(new Date())}.log`);
}

/** 追加 worker 输出到日志（超限截断；失败静默） */
export function appendWorkerLog(logFile: string, chunk: string): void {
  try {
    mkdirSync(dirname(logFile), { recursive: true });
    let size = 0;
    try {
      size = statSync(logFile).size;
    } catch {
      // 首写：文件尚不存在
    }
    if (size >= MAX_WORKER_LOG_BYTES) {
      if (!truncatedFiles.has(logFile)) {
        truncatedFiles.add(logFile);
        appendFileSync(
          logFile,
          `\n[worker log truncated: exceeded ${MAX_WORKER_LOG_BYTES} bytes]\n`,
        );
      }
      return;
    }
    appendFileSync(logFile, chunk);
  } catch {
    // best-effort：日志失败不影响 worker
  }
}

/** 启动清扫：删 N 天前的 worker 日志（目录缺失/权限失败静默）；同步剪枝
 * truncatedFiles 内存集（防无界增长） */
export function sweepWorkerLogs(dataDir: string, retentionDays = WORKER_LOG_RETENTION_DAYS): void {
  try {
    const dir = join(dataDir, WORKER_LOG_SUBDIR);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    for (const f of readdirSync(dir)) {
      if (statSync(join(dir, f)).mtimeMs < cutoff) {
        rmSync(join(dir, f), { force: true });
        truncatedFiles.delete(join(dir, f));
      }
    }
  } catch {
    // 目录不存在/权限不足：静默
  }
}

/** 注入式 spawn（测试用 fake；真实实现见下方 realSpawn）。stdout = 完整标准输出
 * （真实实现捕获；worker 末行 JSON 的 result.stats 是数值写回通道，ADR-0013） */
export type SpawnLike = (
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; logFile?: string },
) => Promise<{ exitCode: number; stdout?: string }>;

/** stdout/stderr 尾巴累积上限（64 KiB——防长命控制面无界增长；stdout 尾巴
 * 还承载末行 stats 写回，stderr 留排障尾巴） */
const TAIL_CAP_BYTES = 64 * 1024;

const realSpawn: SpawnLike = (cmd, args, { timeoutMs, logFile }) => {
  const { promise, resolve, reject } = Promise.withResolvers<{ exitCode: number; stdout: string }>();
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  activeChildren.add(child);
  child.on('exit', () => activeChildren.delete(child));
  // #122：全量落盘（best-effort）；StringDecoder 增量解码防多字节 UTF-8
  // 跨 chunk 截断成 U+FFFD；stdout/stderr 各留 64KiB 尾巴（写回契约的
  // result.stats 在 stdout 末行——必须保尾弃头，环形丢弃最旧的块）
  const stdoutDecoder = new StringDecoder('utf8');
  const stderrDecoder = new StringDecoder('utf8');
  const stdoutBuf: StdoutTail = { chunks: [], bytes: 0 };
  child.stdout?.on('data', (chunk: Buffer) => {
    const text = stdoutDecoder.write(chunk);
    if (logFile) appendWorkerLog(logFile, text);
    appendStdoutTail(stdoutBuf, text);
  });
  const stderr: string[] = [];
  let stderrBytes = 0;
  child.stderr?.on('data', (chunk: Buffer) => {
    if (logFile) appendWorkerLog(logFile, stderrDecoder.write(chunk));
    stderrBytes += chunk.length;
    if (stderrBytes <= TAIL_CAP_BYTES) stderr.push(chunk.toString('utf8'));
  });
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
  }, timeoutMs);
  child.on('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  // 结算挂 close 而非 exit：exit 可在 stdio flush 完成前触发，而写回契约的
  // result.stats 恰是退出前的最后一行——挂 exit 会间歇性丢末行（评审 B-M1）
  child.on('close', (code) => {
    clearTimeout(timer);
    if (code !== 0 && stderr.length > 0) {
      console.error(`[worker-runner] stderr: ${stderr.join('').slice(0, 2000)}`);
    }
    resolve({ exitCode: code ?? -1, stdout: stdoutBuf.chunks.join('') });
  });
  return promise;
};

/** stdout 保尾缓冲（环形丢弃最旧块，保末行 JSON 写回契约） */
export interface StdoutTail {
  chunks: string[];
  bytes: number;
}

/** 追加一块并保尾：总字节超 cap 时从头丢弃最旧块（至少保留最新一块） */
export function appendStdoutTail(
  buf: StdoutTail,
  text: string,
  cap = TAIL_CAP_BYTES,
): void {
  buf.chunks.push(text);
  buf.bytes += Buffer.byteLength(text);
  while (buf.bytes > cap && buf.chunks.length > 1) {
    const dropped = buf.chunks.shift();
    buf.bytes -= dropped ? Buffer.byteLength(dropped) : 0;
  }
}

/** 在飞子进程（优雅关停时统一杀；单 runner 实例内有效） */
const activeChildren = new Set<ReturnType<typeof spawn>>();

/** 杀掉全部在飞 worker（SIGTERM；index.ts 接 SIGTERM/SIGINT 时调用） */
export function stopAllWorkers(): void {
  for (const child of activeChildren) {
    child.kill('SIGTERM');
  }
}

/** 启动清扫：上次进程崩溃残留的明文 secrets 临时文件（0600 仍在 /tmp） */
export async function sweepStaleSecretFiles(): Promise<void> {
  const dir = await readdir(tmpdir());
  await Promise.all(
    dir
      .filter((name) => name.startsWith('cp-secrets-') && name.endsWith('.json'))
      .map((name) => rm(join(tmpdir(), name), { force: true })),
  );
}

export interface WorkerRunnerDeps {
  /** 控制面数据根（找租户 secrets/目录） */
  dataDir: string;
  /** worker 挂死判定（调度器 workerTimeoutMs 传入，保持一致） */
  timeoutMs: number;
  /** spawn 实现（默认 realSpawn；测试注入） */
  spawnFn?: SpawnLike;
  /** 命令（默认 env CP_WORKER_CMD，再退 'bun'） */
  command?: string;
  /** secrets store 打开器（测试可替换） */
  openSecrets?: (dataDir: string, tenantId: string) => Promise<TenantSecretsStore>;
}

export function createWorkerRunner(deps: WorkerRunnerDeps): WorkerRunner {
  const spawnFn = deps.spawnFn ?? realSpawn;
  const command = deps.command ?? process.env.CP_WORKER_CMD ?? 'bun';
  const open = deps.openSecrets ?? openTenantSecrets;
  // #122：启动时清理过期 worker 日志（幂等；失败静默）
  sweepWorkerLogs(deps.dataDir);

  return async (job: WorkerJob): Promise<WorkerResult> => {
    const secretsPath = await writeSecretsFile(open, deps.dataDir, job.tenantId);
    try {
      const args = [AGENT_CLI, '--tenant', job.tenantId, '--data-dir', job.dataDir];
      if (secretsPath) args.push('--secrets-file', secretsPath);
      args.push('--plan-args', JSON.stringify(job.plan));
      args.push('--personality', job.personality);
      if (job.catchphrases !== undefined) args.push('--catchphrases', job.catchphrases);
      // ADR-0013 注入：数值真相源在 pets 表，worker 不读库
      args.push('--pet-state', JSON.stringify(job.petStats));
      const logFile = workerLogPath(deps.dataDir, 'worker', job.tenantId);
      const { exitCode, stdout } = await spawnFn(command, args, { timeoutMs: deps.timeoutMs, logFile });
      if (exitCode !== 0) return { ok: false, exitCode };
      const stats = parseWanderStatsReport(stdout ?? '');
      if (!stats) {
        console.error(`[worker-runner] worker exit 0 但无 stats 回报（${job.tenantId}/${job.petId}）`);
      }
      return { ok: true, exitCode, stats };
    } catch (error) {
      console.error(
        `[worker-runner] 拉起失败（${job.tenantId}/${job.petId}）：`,
        error instanceof Error ? error.message : error,
      );
      return { ok: false, exitCode: -1 };
    } finally {
      if (secretsPath) {
        await rm(secretsPath, { force: true });
      }
    }
  };
}

/**
 * 解析 worker stdout 末行 JSON 的 result.stats（cli.ts 成功出口的唯一行；
 * 取末行防库/调试输出混入）。形状非法返回 undefined——调用方显式告警不落库。
 */
function parseWanderStatsReport(stdout: string): WanderStatsReport | undefined {
  const last = stdout.trim().split('\n').filter(Boolean).pop();
  if (!last) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(last) as unknown;
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const result = (parsed as { result?: unknown }).result;
  if (typeof result !== 'object' || result === null) return undefined;
  const stats = (result as { stats?: unknown }).stats;
  if (typeof stats !== 'object' || stats === null) return undefined;
  const r = stats as Record<string, unknown>;
  if (typeof r.energy !== 'number' || !Number.isFinite(r.energy)) return undefined;
  if (typeof r.boredom !== 'number' || !Number.isFinite(r.boredom)) return undefined;
  return { energy: r.energy, boredom: r.boredom };
}
