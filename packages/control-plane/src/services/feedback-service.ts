/**
 * FeedbackService（应用层）——feedback / boost 用例编排
 *
 * 职责：宠物准入守卫（数值未迁移显式 409，先跑 migrate:pet-stats，
 * 绝不静默跳过）→ boost 额度原子占位与失败回滚 → 拉起 feedback worker →
 * 跨进程回报校验后落库（写回失败仅记日志：反馈本体已成功，不影响主结果）。
 * 子进程协议与存储细节在 infra/，纯规则在 domain/。
 *
 * 编排顺序有讲究：准入守卫先于额度占位（409 不烧配额——按 plan 节流
 * 很苛刻，一次 409 即锁一个间隔）；占位在 spawn 之前（check-then-write
 * 横跨 spawn 会开并发窗口）。
 */

import type { Catchphrase } from '@cyber-stray/shared';
import type { PetMood } from '@cyber-stray/shared/pet-stats';
import { appendCatchphraseHistory } from '../catchphrase-history.js';
import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { isWellFormedStatsUpdate, type StatsUpdate } from '../domain/pet-stats-guard.js';
import { realSpawn, runFeedbackCli, type CliSpawn } from '../infra/agent-cli-client.js';
import * as petsRepo from '../infra/pets-repo.js';
import { findTenantPlan } from '../infra/tenant-access.js';
import { planLimits } from '../plan/limits.js';
import { tenantDataDir } from '../tenant.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 用例结果：ok=false 时 status 为建议 HTTP 状态码，路由层负责映射响应 */
export type FeedbackOutcome =
  | { ok: true; data: unknown }
  | { ok: false; status: 409 | 429 | 502; error: string };

/** worker stdout 结果中与本服务相关的回报字段 */
interface WorkerResult {
  statsUpdated?: StatsUpdate | null;
  catchphrasesUpdated?: Catchphrase[] | null;
}

export interface FeedbackServiceDeps {
  config: Pick<ControlPlaneConfig, 'dataDir'>;
  /** 注入式 spawn（测试用）；缺省真实 spawn */
  spawnFn?: CliSpawn;
}

export function createFeedbackService({ config, spawnFn = realSpawn }: FeedbackServiceDeps) {
  const command = process.env.CP_WORKER_CMD ?? 'bun';

  /** 数值注入参数：worker 的心情增量按库中当前值计算；未迁移（null）返回 null，调用方显式 409 */
  function petStatsArgs(pet: { mood: PetMood | null; temper: number | null }): string[] | null {
    if (pet.mood === null || pet.temper === null) return null;
    return ['--pet-state', JSON.stringify({ mood: pet.mood, temper: pet.temper })];
  }

  /** statsUpdated 落库（已过 domain 守卫）；失败仅记日志——反馈本体已成功 */
  async function applyStatsWriteBack(tenantId: string, workerResult: WorkerResult | undefined) {
    const stats = workerResult?.statsUpdated;
    if (!stats) return;
    if (!isWellFormedStatsUpdate(stats)) {
      console.error(
        `[feedback] statsUpdated 形状非法，拒绝落库（${tenantId}）：`,
        JSON.stringify(stats),
      );
      return;
    }
    try {
      const db = await getDb(config.dataDir);
      await petsRepo.updatePetStats(db, tenantId, stats);
    } catch (error) {
      console.error(`[feedback] 心情写回失败（${tenantId}）：`, error);
    }
  }

  /** 口头禅归因写回：worker 带出调整后集合 → pets + 演化历史；失败仅记日志 */
  async function applyCatchphrasesWriteBack(
    tenantId: string,
    workerResult: WorkerResult | undefined,
  ) {
    if (!workerResult?.catchphrasesUpdated) return;
    try {
      const updated = workerResult.catchphrasesUpdated;
      const db = await getDb(config.dataDir);
      await petsRepo.updateCatchphrases(db, tenantId, updated);
      await appendCatchphraseHistory(
        tenantDataDir(config.dataDir, tenantId),
        'feedback',
        updated,
      );
    } catch (error) {
      console.error(`[feedback] 口头禅写回失败（${tenantId}）：`, error);
    }
  }

  /** 点赞/踩：不受限（低价值高频信号），worker 处理归因与心情增量 */
  async function submitFeedback(
    tenantId: string,
    input: { type: 'like' | 'dislike'; messageId: string },
  ): Promise<FeedbackOutcome> {
    const db = await getDb(config.dataDir);
    const pet = await petsRepo.findPetByTenant(db, tenantId);
    if (!pet) return { ok: false, status: 409, error: '尚未领养宠物' };

    const statsArgs = petStatsArgs(pet);
    if (!statsArgs) {
      return { ok: false, status: 409, error: '宠物数值未迁移，先执行 migrate:pet-stats' };
    }

    const worker = await runFeedbackCli(
      spawnFn,
      command,
      { dataDir: tenantDataDir(config.dataDir, tenantId), tenantId },
      [
        '--action',
        'feedback',
        '--type',
        input.type,
        '--message-id',
        input.messageId,
        '--user-id',
        tenantId,
        ...statsArgs,
        // 宠物当前口头禅集合——归因权重要落在真实集合上
        //（不传则 worker 回退性格默认组，归因落空）
        ...(pet.catchphrases ? ['--catchphrases', pet.catchphrases] : []),
      ],
    );
    if (worker.error) return { ok: false, status: 502, error: worker.error };

    const workerResult = worker.data as WorkerResult | undefined;
    await applyStatsWriteBack(tenantId, workerResult);
    await applyCatchphrasesWriteBack(tenantId, workerResult);
    return { ok: true, data: worker.data ?? {} };
  }

  /** 顶话题：显式「我要更多」高价值信号，按 plan 节流（策略源 plan/limits.ts） */
  async function boostTopic(tenantId: string, topic: string): Promise<FeedbackOutcome> {
    const db = await getDb(config.dataDir);
    const pet = await petsRepo.findPetByTenant(db, tenantId);
    if (!pet) return { ok: false, status: 409, error: '尚未领养宠物' };

    const plan = (await findTenantPlan(config.dataDir, tenantId)) ?? 'free';
    const statsArgs = petStatsArgs(pet);
    if (!statsArgs) {
      return { ok: false, status: 409, error: '宠物数值未迁移，先执行 migrate:pet-stats' };
    }

    const intervalMs = planLimits(plan).boostIntervalMs;
    const claimed = await petsRepo.claimBoostQuota(db, tenantId, intervalMs, Date.now());
    if (!claimed) {
      return {
        ok: false,
        status: 429,
        error: `当前套餐每 ${Math.ceil(intervalMs / DAY_MS)} 天可顶一次话题`,
      };
    }

    const worker = await runFeedbackCli(
      spawnFn,
      command,
      { dataDir: tenantDataDir(config.dataDir, tenantId), tenantId },
      ['--action', 'boost', '--topic', topic, '--user-id', tenantId, ...statsArgs],
    );
    if (worker.error) {
      await petsRepo.rollbackBoostQuota(db, tenantId, pet.lastBoostAt);
      return { ok: false, status: 502, error: worker.error };
    }

    await applyStatsWriteBack(tenantId, worker.data as WorkerResult | undefined);
    return { ok: true, data: worker.data ?? {} };
  }

  return { submitFeedback, boostTopic };
}

export type FeedbackService = ReturnType<typeof createFeedbackService>;
