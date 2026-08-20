/**
 * diary-runner — 睡前任务短命 worker 拉起（#92）
 *
 * 与 worker-runner（游荡）同模式：spawn agent 包 diary-cli 子进程，跑完退出。
 * `bun packages/agent/src/worker/diary-cli.ts --tenant <id> --data-dir <dir>
 * --pet-name <名> --date <YYYY-MM-DD> --personality <id> --diary-style <choice>
 * --push-enabled true`。
 *
 * per-tenant secrets 复用 worker-runner 的写临时文件机制（writeSecretsFile +
 * sweepStaleSecretFiles 共享同一前缀），跑完即删。
 */

import { spawn, type ChildProcess } from 'child_process';
import { rm } from 'fs/promises';
import { fileURLToPath } from 'url';
import { openTenantSecrets, type TenantSecretsStore } from '../secrets/tenant-secrets.js';
import { writeSecretsFile } from '../secrets/worker-secrets.js';
import type { DiaryStyleChoice } from '@cyber-stray/shared/diary';
import type { PersonalityId } from '@cyber-stray/shared';

/** agent 日记 CLI 绝对路径（仓库内锚定，与 worker-runner 的 AGENT_CLI 同模式） */
const DIARY_CLI = fileURLToPath(
  new URL('../../../agent/src/worker/diary-cli.ts', import.meta.url),
);

/** 注入式 spawn（测试 fake；真实实现见下方 realSpawn） */
export type DiarySpawnLike = (
  cmd: string,
  args: string[],
  opts: { timeoutMs: number },
) => Promise<{ exitCode: number }>;

const realSpawn: DiarySpawnLike = (cmd, args, { timeoutMs }) => {
  const { promise, resolve, reject } = Promise.withResolvers<{ exitCode: number }>();
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  activeChildren.add(child);
  child.on('exit', () => activeChildren.delete(child));
  const stderr: string[] = [];
  child.stderr?.on('data', (chunk: Buffer) => {
    if (stderr.join('').length < 2000) stderr.push(chunk.toString('utf8'));
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
      console.error(`[diary-runner] stderr: ${stderr.join('').slice(0, 2000)}`);
    }
    resolve({ exitCode: code ?? -1 });
  });
  return promise;
};

/** 在飞子进程（优雅关停时统一杀；与 worker-runner 分开管理） */
const activeChildren = new Set<ChildProcess>();

/** 杀掉全部在飞日记 worker（SIGTERM） */
export function stopAllDiaryWorkers(): void {
  for (const child of activeChildren) {
    child.kill('SIGTERM');
  }
}

/** 睡前任务作业 */
export interface DiaryJob {
  tenantId: string;
  petId: string;
  /** 租户数据目录（tenants/<sub>/） */
  dataDir: string;
  petName: string;
  /** 日记日期（YYYY-MM-DD） */
  date: string;
  personality: PersonalityId;
  diaryStyle: DiaryStyleChoice;
  /** 是否推送日记（Web Push） */
  pushEnabled: boolean;
}

/** 结果：ok = 完成或跳过（exit 0） */
export interface DiaryWorkerResult {
  ok: boolean;
  exitCode: number;
}

export interface DiaryRunnerDeps {
  /** 控制面数据根（找租户 secrets） */
  dataDir: string;
  timeoutMs: number;
  spawnFn?: DiarySpawnLike;
  command?: string;
  openSecrets?: (dataDir: string, tenantId: string) => Promise<TenantSecretsStore>;
}

export type DiaryRunner = (job: DiaryJob) => Promise<DiaryWorkerResult>;

export function createDiaryRunner(deps: DiaryRunnerDeps): DiaryRunner {
  const spawnFn = deps.spawnFn ?? realSpawn;
  const command = deps.command ?? process.env.CP_WORKER_CMD ?? 'bun';
  const open = deps.openSecrets ?? openTenantSecrets;

  return async (job: DiaryJob): Promise<DiaryWorkerResult> => {
    const secretsPath = await writeSecretsFile(open, deps.dataDir, job.tenantId);
    try {
      const args = [
        DIARY_CLI,
        '--tenant',
        job.tenantId,
        '--data-dir',
        job.dataDir,
        '--pet-name',
        job.petName,
        '--date',
        job.date,
        '--personality',
        job.personality,
        '--diary-style',
        job.diaryStyle,
      ];
      if (job.pushEnabled) args.push('--push-enabled', 'true');
      if (secretsPath) args.push('--secrets-file', secretsPath);
      const { exitCode } = await spawnFn(command, args, { timeoutMs: deps.timeoutMs });
      return { ok: exitCode === 0, exitCode };
    } catch (error) {
      console.error(
        `[diary-runner] 拉起失败（${job.tenantId}/${job.petId}）：`,
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

