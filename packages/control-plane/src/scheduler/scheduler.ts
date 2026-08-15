/**
 * 调度器（S5，嵌入控制面进程）
 *
 * 无常驻宠物进程：周期 tick 扫宠物表 → 时间前推无聊/精力（pure，见 propagate）
 * → 取"就绪"宠物 → 并发上限内拉起短命 worker 跑一轮游荡 → 写回 SQLite 退出。
 * worker 的 --data-dir 是**租户数据目录**（tenants/<sub>/，记忆/状态所在），
 * 不是控制面数据根。
 *
 * 崩溃兜底（lease + 重试）：
 * - running 表：在飞任务（petId → {startedAt, gen}）；超过 workerTimeoutMs 视为
 *   挂死可重认领（worker_timeout 事件）。gen 令牌保证 TTL 重认领后，旧任务的
 *   finally 不误删新任务条目、旧任务不写回过期状态
 * - 失败重试：退避后下一 tick 重拉；maxRetries 超限放弃 → **DB 冷却**
 *   （cooldown_until + 同步落真实 boredom/energy，重启安全、状态不伪造）
 * - 游荡数据由 worker 的 state.json 维护（租户目录），失败不丢
 *
 * 进程边界（单实例控制面）：
 * - tick 错误 log-and-continue（不打死 HTTP 服务）
 * - 优雅关停（stop）停 tick；在飞 worker 由 runner 的 stopAll 兜底杀（index.ts
 *   接 SIGTERM/SIGINT）。硬杀（SIGKILL）下 worker 可能成孤儿——已知限制，
 *   多实例部署前需 DB 级租约
 *
 * 事件：全部发租户通道（events/bus，S8 SSE 消费）。
 */

import { eq } from 'drizzle-orm';
import type { ControlDb } from '../db/client.js';
import { pets } from '../db/schema.js';
import type { EventBus } from '../events/bus.js';
import { tenantDataDir } from '../tenant.js';
import {
  propagate,
  isReady,
  WANDER_BOREDOM_RELIEF,
  WANDER_ENERGY_COST,
  type PropagationRates,
  type PropagatedState,
} from './propagate.js';

export { MINUTE_MS } from './propagate.js';

/** 一次游荡任务（runner 入参） */
export interface WorkerJob {
  tenantId: string;
  petId: string;
  /** 租户数据目录（tenants/<sub>/，agent 的 DATA_DIR） */
  dataDir: string;
}

/** runner 结果：ok = 游荡完成（exit 0） */
export interface WorkerResult {
  ok: boolean;
  exitCode: number;
}

/** worker 执行器（生产实现见 worker-runner.ts；测试注入 fake） */
export type WorkerRunner = (job: WorkerJob) => Promise<WorkerResult>;

/** 调度参数 */
export interface SchedulerConfig {
  /** 并发上限（2C4G 默认 4） */
  maxConcurrent: number;
  /** 单宠最大重试次数（不含首发） */
  maxRetries: number;
  /** 失败退避（ms） */
  retryBackoffMs: number;
  /** worker 挂死判定（ms） */
  workerTimeoutMs: number;
  /** 前推速率 */
  rates: PropagationRates;
}

export interface SchedulerDeps {
  db: () => Promise<ControlDb>;
  /** 控制面数据根（租户目录 = tenants/<sub>/） */
  dataDir: string;
  bus: EventBus;
  runner: WorkerRunner;
  now: () => number;
  config: SchedulerConfig;
}

/** 失败重试租约（内存；进程重启清零，重试上限由 DB 冷却兜底） */
interface Lease {
  retries: number;
  nextEligibleAt: number;
}

/** 在飞任务条目（gen 令牌防 TTL 重认领后旧任务误删新条目） */
interface RunningEntry {
  startedAt: number;
  gen: number;
}

export class Scheduler {
  private readonly running = new Map<string, RunningEntry>();
  private readonly leases = new Map<string, Lease>();
  private readonly inFlight = new Set<Promise<void>>();
  private genCounter = 0;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly deps: SchedulerDeps) {}

  /** 周期启动（intervalMs = 0 不启动，测试/关闭用）。tick 错误 log-and-continue。 */
  start(intervalMs: number): void {
    this.stop();
    if (intervalMs <= 0) return;
    this.timer = setInterval(() => {
      this.tick().catch((error: unknown) => {
        console.error('[scheduler] tick 失败：', error instanceof Error ? error.message : error);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** 单次 tick（测试直接驱动；start 内部也走这里） */
  async runOnce(): Promise<void> {
    await this.tick();
  }

  /** 等所有在飞任务落定（测试/优雅关停用） */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  /** 在飞任务数（可观测） */
  runningCount(): number {
    return this.running.size;
  }

  private async tick(): Promise<void> {
    const { db, dataDir, bus, runner, now, config } = this.deps;
    const nowMs = now();

    // TTL 清理：挂死超时的任务标记死亡，允许重新认领（旧任务持有旧 gen，
    // 其 finally/写回被 gen 校验挡住）
    for (const [petId, entry] of this.running) {
      if (nowMs - entry.startedAt > config.workerTimeoutMs) {
        this.running.delete(petId);
        const pet = await this.findPet(petId);
        if (pet) {
          bus.publish(pet.tenantId, {
            type: 'worker_timeout',
            tenantId: pet.tenantId,
            petId,
            at: nowMs,
          });
        }
      }
    }

    const dbh = await db();
    const rows = await dbh.select().from(pets).all();

    for (const pet of rows) {
      if (pet.status !== 'active') continue;
      if (pet.cooldownUntil !== null && nowMs < pet.cooldownUntil) continue; // DB 冷却
      if (this.running.has(pet.id)) continue;

      const lease = this.leases.get(pet.id);
      if (lease && nowMs < lease.nextEligibleAt) continue; // 退避中
      if (this.running.size >= config.maxConcurrent) break; // 并发上限

      const state = propagate(pet, nowMs, config.rates);
      if (!isReady(state)) continue;

      bus.publish(pet.tenantId, {
        type: 'pet_ready',
        tenantId: pet.tenantId,
        petId: pet.id,
        at: nowMs,
      });
      this.launch(pet.id, pet.tenantId, state, dataDir, bus, runner, now, config);
    }
  }

  /**
   * 拉起一个短命 worker（fire-and-forget；写回/重试/租约都在这里收口）。
   * gen 令牌：TTL 重认领产生新 gen 后，旧任务不再持有 running 条目——
   * finally 不删新条目，写回/租约变更全部跳过（防过期状态覆盖）。
   */
  private launch(
    petId: string,
    tenantId: string,
    state: PropagatedState,
    dataRoot: string,
    bus: EventBus,
    runner: WorkerRunner,
    now: () => number,
    config: SchedulerConfig,
  ): void {
    const startedAt = now();
    const gen = ++this.genCounter;
    this.running.set(petId, { startedAt, gen });
    /** 我是否仍是该宠物当前在飞任务的持有者 */
    const isOwner = () => this.running.get(petId)?.gen === gen;

    const task = (async () => {
      bus.publish(tenantId, {
        type: 'worker_started',
        tenantId,
        petId,
        at: startedAt,
      });
      try {
        const result = await runner({
          tenantId,
          petId,
          dataDir: tenantDataDir(dataRoot, tenantId), // 租户目录，非控制面根
        });
        if (!result.ok) {
          throw new Error(`worker 退出码 ${result.exitCode}`);
        }
        if (!isOwner()) return; // 已被 TTL 重认领：过期结果不写回
        // 成功：写回 SQLite（前推值扣游荡消耗）
        const endAt = now();
        const dbh = await this.deps.db();
        await dbh
          .update(pets)
          .set({
            lastRunAt: endAt,
            boredom: Math.max(0, Math.round(state.boredom - WANDER_BOREDOM_RELIEF)),
            energy: Math.max(0, Math.round(state.energy - WANDER_ENERGY_COST)),
          })
          .where(eq(pets.id, petId))
          .run();
        this.leases.delete(petId);
        bus.publish(tenantId, {
          type: 'worker_succeeded',
          tenantId,
          petId,
          at: endAt,
        });
      } catch (error) {
        if (!isOwner()) return; // 已被 TTL 重认领：旧失败不干预新任务
        // 失败：lease 重试；超限放弃 + DB 冷却
        const failAt = now();
        const prior = this.leases.get(petId);
        const retries = (prior?.retries ?? 0) + 1;
        if (retries <= config.maxRetries) {
          this.leases.set(petId, {
            retries,
            nextEligibleAt: failAt + config.retryBackoffMs,
          });
          bus.publish(tenantId, {
            type: 'worker_retry',
            tenantId,
            petId,
            at: failAt,
            detail: error instanceof Error ? error.message : String(error),
          });
        } else {
          this.leases.delete(petId);
          // DB 冷却（重启安全）：重置前推基线（lastRunAt）+ 落"消耗了就绪"的
          // 自洽状态（与成功路径同构），三者一致，冷却后从低无聊重新攒
          const dbh = await this.deps.db();
          await dbh
            .update(pets)
            .set({
              lastRunAt: failAt,
              boredom: Math.max(0, Math.round(state.boredom - WANDER_BOREDOM_RELIEF)),
              energy: Math.max(0, Math.round(state.energy - WANDER_ENERGY_COST)),
              cooldownUntil: failAt + config.retryBackoffMs,
            })
            .where(eq(pets.id, petId))
            .run();
          bus.publish(tenantId, {
            type: 'worker_failed',
            tenantId,
            petId,
            at: failAt,
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        // 只删自己持有的条目（TTL 重认领后条目属于新任务）
        if (isOwner()) this.running.delete(petId);
      }
    })();
    this.inFlight.add(task);
    void task.finally(() => this.inFlight.delete(task));
  }

  private async findPet(petId: string) {
    const dbh = await this.deps.db();
    return dbh.select().from(pets).where(eq(pets.id, petId)).get();
  }
}
