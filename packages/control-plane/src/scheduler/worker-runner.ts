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
import { randomBytes } from 'crypto';
import { chmod, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { openTenantSecrets, type TenantSecretsStore } from '../secrets/tenant-secrets.js';
import type { WorkerJob, WorkerResult, WorkerRunner } from './scheduler.js';

/** agent 包 CLI 绝对路径（仓库内锚定，无硬编码全路径） */
const AGENT_CLI = fileURLToPath(
  new URL('../../../agent/src/worker/cli.ts', import.meta.url),
);

/** secrets store 名 → AgentSecrets 字段（S4 存储名约定） */
const SECRET_FIELD_BY_NAME: Record<string, string> = {
  deepseek_api_key: 'deepseekApiKey',
  tavily_api_key: 'tavilyApiKey',
  exa_api_key: 'exaApiKey',
  feishu_webhook: 'feishuWebhook',
};

/** 注入式 spawn（测试用 fake；真实实现见下方 realSpawn） */
export type SpawnLike = (
  cmd: string,
  args: string[],
  opts: { timeoutMs: number },
) => Promise<{ exitCode: number }>;

/** stderr 累积上限（64 KiB——防长命控制面无界增长，只留排障尾巴） */
const STDERR_CAP_BYTES = 64 * 1024;

const realSpawn: SpawnLike = (cmd, args, { timeoutMs }) => {
  const { promise, resolve, reject } = Promise.withResolvers<{ exitCode: number }>();
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  activeChildren.add(child);
  child.on('exit', () => activeChildren.delete(child));
  const stderr: string[] = [];
  let stderrBytes = 0;
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrBytes += chunk.length;
    if (stderrBytes <= STDERR_CAP_BYTES) stderr.push(chunk.toString('utf8'));
  });
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
  }, timeoutMs);
  child.on('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.on('exit', (code) => {
    clearTimeout(timer);
    if (code !== 0 && stderr.length > 0) {
      console.error(`[worker-runner] stderr: ${stderr.join('').slice(0, 2000)}`);
    }
    resolve({ exitCode: code ?? -1 });
  });
  return promise;
};

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

/** 解密租户 secrets → AgentSecrets 对象；无任何项返回 null */
async function resolveAgentSecrets(
  open: (dataDir: string, tenantId: string) => Promise<TenantSecretsStore>,
  dataDir: string,
  tenantId: string,
): Promise<Record<string, string> | null> {
  const store = await open(dataDir, tenantId);
  const names = await store.list();
  const secrets: Record<string, string> = {};
  for (const name of names) {
    const field = SECRET_FIELD_BY_NAME[name];
    if (!field) continue;
    secrets[field] = (await store.get(name)) ?? '';
  }
  return Object.keys(secrets).length > 0 ? secrets : null;
}

export function createWorkerRunner(deps: WorkerRunnerDeps): WorkerRunner {
  const spawnFn = deps.spawnFn ?? realSpawn;
  const command = deps.command ?? process.env.CP_WORKER_CMD ?? 'bun';
  const open = deps.openSecrets ?? openTenantSecrets;

  return async (job: WorkerJob): Promise<WorkerResult> => {
    const secretsPath = await writeSecretsFile(open, deps.dataDir, job.tenantId);
    try {
      const args = [AGENT_CLI, '--tenant', job.tenantId, '--data-dir', job.dataDir];
      if (secretsPath) args.push('--secrets-file', secretsPath);
      const { exitCode } = await spawnFn(command, args, { timeoutMs: deps.timeoutMs });
      return { ok: exitCode === 0, exitCode };
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

/** 有 secrets → 写 0600 临时 JSON（跑完由调用方删）；无 → null */
async function writeSecretsFile(
  open: (dataDir: string, tenantId: string) => Promise<TenantSecretsStore>,
  dataDir: string,
  tenantId: string,
): Promise<string | null> {
  const secrets = await resolveAgentSecrets(open, dataDir, tenantId);
  if (!secrets) return null;
  const path = join(tmpdir(), `cp-secrets-${tenantId}-${randomBytes(8).toString('hex')}.json`);
  await writeFile(path, JSON.stringify(secrets), { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}
