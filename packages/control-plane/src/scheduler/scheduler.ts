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
import { pets, tenants } from '../db/schema.js';
import type { EventBus } from '../events/bus.js';
import { tenantDataDir } from '../tenant.js';
import { planLimits } from '../plan/limits.js';
import {
  propagate,
  isReady,
  resolveRates,
  resolveWanderEffects,
  type PropagationRates,
  type PropagatedState,
  type WanderEffects,
} from './propagate.js';
import type { PersonalityId } from '@cyber-stray/shared';
import type { DiaryStyleChoice } from '@cyber-stray/shared/diary';
import { isSleeping } from './sleep.js';
import { DIARY_FALLBACK_HOUR, shouldGenerateDiary } from './diary-schedule.js';
import type { DiaryRunner } from './diary-runner.js';

export { MINUTE_MS } from './propagate.js';

/** 本地日期字符串（YYYY-MM-DD；日记文件名与按天去重基准） */
function todayFor(nowMs: number): string {
  const d = new Date(nowMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 套餐执行参数（S11：scheduler 从 pet 行带出，runner 透传 worker CLI） */
export interface PlanJobArgs {
  plan: 'free' | 'pro' | 'byok';
  /** 每日推送上限（gate 放行 speak 落盘数） */
  pushesPerDay: number;
  /** 推送时间窗（本地小时；null = 全天） */
  pushWindowStart: number | null;
  pushWindowEnd: number | null;
}

/** 一次游荡任务（runner 入参） */
export interface WorkerJob {
  tenantId: string;
  petId: string;
  /** 租户数据目录（tenants/<sub>/，agent 的 DATA_DIR） */
  dataDir: string;
  /** 套餐执行参数（S11 门控） */
  plan: PlanJobArgs;
  /** 性格（#90：agent 侧探索倾向 + 语气注入；worker CLI --personality） */
  personality: PersonalityId;
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
  /** 前推速率基准（DEFAULT_RATES；性格倍率乘在此基准上） */
  rates: PropagationRates;
}

export interface SchedulerDeps {
  db: () => Promise<ControlDb>;
  /** 控制面数据根（租户目录 = tenants/<sub>/） */
  dataDir: string;
  bus: EventBus;
  runner: WorkerRunner;
  /** 睡前任务执行器（#92；spawn diary-cli） */
  diaryRunner: DiaryRunner;
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
  /** #92 日记：在飞睡前任务（petId → startedAt；防同 tick 重复拉起） */
  private readonly diaryRunning = new Map<string, number>();
  /** #92 日记：日记到期未完成（petId → 窗口内重试；窗口退出/完成即清） */
  private readonly diaryPending = new Set<string>();
  /** #92 日记：每宠上次 tick 是否睡眠中（跨 tick 记忆，检测睡眠开始） */
  private readonly wasSleeping = new Map<string, boolean>();
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
    // S14：套餐在账号层（tenants.plan）——一次拉租户 plan 映射，避免 N+1
    const tenantRows = await dbh.select().from(tenants).all();
    const planByTenant = new Map(tenantRows.map((t) => [t.id, t.plan]));
    // #91 真实作息：服务器本地小时（与 pushWindow 语义对齐——窗口小时在
    // 消费进程本地时区判定）；睡眠中不拉 worker，醒来后下一 tick 自动恢复
    const localHour = new Date(nowMs).getHours();

    for (const pet of rows) {
      if (pet.status !== 'active') continue;
      if (pet.cooldownUntil !== null && nowMs < pet.cooldownUntil) continue; // DB 冷却
      // 睡眠期跳过游荡（游荡计数不增长）；未设置作息恒 false，与现状一致
      if (isSleeping(localHour, pet.sleepStart, pet.sleepEnd)) continue;
      if (this.running.has(pet.id)) continue;

      const lease = this.leases.get(pet.id);
      if (lease && nowMs < lease.nextEligibleAt) continue; // 退避中
      if (this.running.size >= config.maxConcurrent) break; // 并发上限

      // #90 性格：按宠物性格解析速率（好奇=基准，存量行为不变）
      const state = propagate(pet, nowMs, resolveRates(pet.personality, config.rates));
      if (!isReady(state)) continue;

      bus.publish(pet.tenantId, {
        type: 'pet_ready',
        tenantId: pet.tenantId,
        petId: pet.id,
        at: nowMs,
      });
      this.launch(
        { ...pet, plan: planByTenant.get(pet.tenantId) ?? 'free' },
        state,
        dataDir,
        bus,
        runner,
        now,
        config,
      );
    }

    // #92 睡前任务：睡眠开始（或无作息固定时刻）触发当天日记。
    // 与游荡解耦——独立 diaryRunning 在飞集合，不占游荡并发槽。
    this.runDiaryTriggers(rows, dataDir, nowMs, localHour, todayFor(nowMs));
  }

  /**
   * 睡前任务触发：对每只 active 宠物按 shouldGenerateDiary 判定，命中则
   * 拉起 diary-cli 生成当天日记。
   *
   * 状态机（跨 tick 记忆）：
   * - wasSleeping：上次 tick 睡眠态，检测"睡眠开始"跳变
   * - diaryPending：日记到期未完成（进入睡眠窗口 / 命中固定时刻）；窗口内每
   *   tick 重试（失败不丢），窗口退出（醒来 / 时刻已过）放弃
   * - diaryRunning：在飞 worker（防同 tick 重复拉起）
   * 重启：首次观测播种 wasSleeping（不触发）；若恰在睡眠窗口头部（今天入睡）
   * 且今天未生成 → 补触发（跨午夜尾部不补，防睡眠中段多生成一篇）。
   */
  private runDiaryTriggers(
    rows: Array<{ id: string; tenantId: string; status: string; name: string; personality: string; diaryStyle: string; diaryPushEnabled: boolean | number; sleepStart: number | null; sleepEnd: number | null; lastDiaryDate: string | null }>,
    dataRoot: string,
    nowMs: number,
    localHour: number,
    today: string,
  ): void {
    for (const pet of rows) {
      if (pet.status !== 'active') continue;

      const sleepingNow = isSleeping(localHour, pet.sleepStart, pet.sleepEnd);
      const prevSleeping = this.wasSleeping.get(pet.id);

      if (prevSleeping === undefined) {
        // 首次观测：播种当前态不触发
        const seedSleeping = sleepingNow;
        this.wasSleeping.set(pet.id, seedSleeping);
        // 恰在睡眠窗口头部（今天入睡）且今天未生成 → 补触发
        const inHead =
          pet.sleepStart !== null &&
          pet.sleepEnd !== null &&
          sleepingNow &&
          !(pet.sleepStart > pet.sleepEnd && localHour < pet.sleepEnd);
        if (inHead && pet.lastDiaryDate !== today) {
          this.diaryPending.add(pet.id);
          this.maybeLaunchDiary(pet, dataRoot, today, nowMs);
        }
        continue;
      }

      const wasSleeping = prevSleeping;
      this.wasSleeping.set(pet.id, sleepingNow);

      // 睡眠窗口（有作息）或固定时刻（无作息）
      const inWindow = pet.sleepStart !== null ? sleepingNow : localHour === DIARY_FALLBACK_HOUR;
      const justEntered = pet.sleepStart !== null ? sleepingNow && !wasSleeping : inWindow;
      if (justEntered) this.diaryPending.add(pet.id);
      if (!inWindow) this.diaryPending.delete(pet.id); // 窗口退出：放弃（下次窗口再试）
      if (pet.lastDiaryDate === today) {
        this.diaryPending.delete(pet.id); // 今天已处理
        continue;
      }
      if (!this.diaryPending.has(pet.id)) continue;

      this.maybeLaunchDiary(pet, dataRoot, today, nowMs);
    }
  }

  /** 若不在飞则拉起日记 worker */
  private maybeLaunchDiary(
    pet: { id: string; tenantId: string; name: string; personality: string; diaryStyle: string; diaryPushEnabled: boolean | number },
    dataRoot: string,
    today: string,
    nowMs: number,
  ): void {
    if (this.diaryRunning.has(pet.id)) return;
    const petId = pet.id;
    const tenantId = pet.tenantId;
    this.diaryRunning.set(petId, nowMs);
    const diaryStyle = (['casual', 'careful', 'literary', 'personality'] as const).includes(
      pet.diaryStyle as DiaryStyleChoice,
    )
      ? (pet.diaryStyle as DiaryStyleChoice)
      : 'personality';

    const task = (async () => {
      try {
        const result = await this.deps.diaryRunner({
          tenantId,
          petId,
          dataDir: tenantDataDir(dataRoot, tenantId),
          petName: pet.name,
          date: today,
          personality: pet.personality as PersonalityId,
          diaryStyle,
          pushEnabled: Boolean(pet.diaryPushEnabled),
        });
        if (!result.ok) {
          throw new Error(`日记 worker 退出码 ${result.exitCode}`);
        }
        // 无论生成还是跳过，都记"今天已处理"（无内容天不反复拉起）
        const dbh = await this.deps.db();
        await dbh
          .update(pets)
          .set({ lastDiaryDate: today })
          .where(eq(pets.id, petId))
          .run();
        this.diaryPending.delete(petId);
        this.deps.bus.publish(tenantId, {
          type: 'diary_generated',
          tenantId,
          petId,
          at: nowMs,
          detail: today,
        });
      } catch (error) {
        console.error(
          `[scheduler] 睡前任务失败（${tenantId}/${petId}）：`,
          error instanceof Error ? error.message : error,
        );
        // 不置 lastDiaryDate、不清 pending：窗口内下一 tick 重试
      } finally {
        this.diaryRunning.delete(petId);
      }
    })();
    this.inFlight.add(task);
    void task.finally(() => this.inFlight.delete(task));
  }



  /**
   * 拉起一个短命 worker（fire-and-forget；写回/重试/租约都在这里收口）。
   * gen 令牌：TTL 重认领产生新 gen 后，旧任务不再持有 running 条目——
   * finally 不删新条目，写回/租约变更全部跳过（防过期状态覆盖）。
   * S5 review 修复：拆分成功写回（handleSuccess）与失败处理（handleFailure）。
   */
  private launch(
    pet: { id: string; tenantId: string; plan: string; pushWindowStart: number | null; pushWindowEnd: number | null; personality: PersonalityId },
    state: PropagatedState,
    dataRoot: string,
    bus: EventBus,
    runner: WorkerRunner,
    now: () => number,
    config: SchedulerConfig,
  ): void {
    const petId = pet.id;
    const tenantId = pet.tenantId;
    const startedAt = now();
    const gen = ++this.genCounter;
    this.running.set(petId, { startedAt, gen });
    // #90：游荡效果按性格解析一次（写回/冷却共用同一组系数，落库一致）
    const effects = resolveWanderEffects(pet.personality);
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
          plan: this.planArgsFor(pet),
          personality: pet.personality,
        });
        if (!result.ok) {
          throw new Error(`worker 退出码 ${result.exitCode}`);
        }
        if (!isOwner()) return; // 已被 TTL 重认领：过期结果不写回
        await this.handleSuccess(petId, tenantId, state, effects, bus, now);
      } catch (error) {
        if (!isOwner()) return; // 已被 TTL 重认领：旧失败不干预新任务
        await this.handleFailure(petId, tenantId, state, effects, bus, now, config, error);
      } finally {
        // 只删自己持有的条目（TTL 重认领后条目属于新任务）
        if (isOwner()) this.running.delete(petId);
      }
    })();
    this.inFlight.add(task);
    void task.finally(() => this.inFlight.delete(task));
  }

  /** 套餐执行参数（S11：scheduler 是策略点，runner 机械透传） */
  private planArgsFor(pet: {
    plan: string;
    pushWindowStart: number | null;
    pushWindowEnd: number | null;
  }): PlanJobArgs {
    return {
      plan: (pet.plan === 'pro' || pet.plan === 'byok' ? pet.plan : 'free') as PlanJobArgs['plan'],
      pushesPerDay: planLimits(pet.plan).pushesPerDay,
      pushWindowStart: pet.pushWindowStart,
      pushWindowEnd: pet.pushWindowEnd,
    };
  }

  /** 成功：写回 SQLite（前推值扣游荡消耗）+ 清理租约 + 事件 */
  private async handleSuccess(
    petId: string,
    tenantId: string,
    state: PropagatedState,
    effects: WanderEffects,
    bus: EventBus,
    now: () => number,
  ): Promise<void> {
    const endAt = now();
    const dbh = await this.deps.db();
    await dbh
      .update(pets)
      .set({
        lastRunAt: endAt,
        boredom: Math.max(0, Math.round(state.boredom - effects.boredomRelief)),
        energy: Math.max(0, Math.round(state.energy - effects.energyCost)),
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
  }

  /** 失败：lease 重试；超限放弃 + DB 冷却（重启安全） */
  private async handleFailure(
    petId: string,
    tenantId: string,
    state: PropagatedState,
    effects: WanderEffects,
    bus: EventBus,
    now: () => number,
    config: SchedulerConfig,
    error: unknown,
  ): Promise<void> {
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
      return;
    }
    this.leases.delete(petId);
    // DB 冷却：重置前推基线（lastRunAt）+ 落"消耗了就绪"的自洽状态
    // （与成功路径同构），三者一致，冷却后从低无聊重新攒
    const dbh = await this.deps.db();
    await dbh
      .update(pets)
      .set({
        lastRunAt: failAt,
        boredom: Math.max(0, Math.round(state.boredom - effects.boredomRelief)),
        energy: Math.max(0, Math.round(state.energy - effects.energyCost)),
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

  private async findPet(petId: string) {
    const dbh = await this.deps.db();
    return dbh.select().from(pets).where(eq(pets.id, petId)).get();
  }
}
