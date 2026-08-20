/**
 * 调度器测试（S5）
 *
 * 契约（#72）：
 * - 无常驻宠物进程：就绪（前推后无聊≥70 且精力≥40）才拉起，跑完写回 SQLite 退出
 * - 并发上限生效：running 数达上限后不再拉起
 * - worker 崩溃：lease 重试（退避后下一 tick 重拉），超限放弃并冷却（lastRunAt 前移）
 * - 租户隔离的事件发布（bus 路由测试见 events/bus.test.ts）
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import { getDb, _resetDb, type ControlDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { pets } from '../db/schema.js';
import { getOrCreateTenant } from '../tenant.js';
import { createEventBus, type EventBus } from '../events/bus.js';
import {
  Scheduler,
  MINUTE_MS,
  type WorkerJob,
  type WorkerResult,
  type WorkerRunner,
} from './scheduler.js';

describe('调度器', () => {
  let dataDir: string;
  let db: ControlDb;
  let bus: EventBus;
  let runner: Mock<(job: WorkerJob) => Promise<WorkerResult>>;
  let clock: { now: number };
  let sched: Scheduler;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-sched-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 't1');
    await getOrCreateTenant(dataDir, 't2');
    db = await getDb(dataDir);
    bus = createEventBus();
    runner = vi.fn(
      async (_job: WorkerJob): Promise<WorkerResult> => ({ ok: true, exitCode: 0 }),
    );
    clock = { now: 10 * MINUTE_MS }; // lastRunAt=0 → elapsed 恰 10 分钟，断言可整
    sched = makeScheduler();
  });

  afterEach(() => {
    sched.stop();
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function makeScheduler(overrides?: {
    maxConcurrent?: number;
    maxRetries?: number;
    retryBackoffMs?: number;
    workerTimeoutMs?: number;
  }) {
    return new Scheduler({
      db: () => getDb(dataDir),
      dataDir,
      bus,
      runner,
      now: () => clock.now,
      config: {
        maxConcurrent: overrides?.maxConcurrent ?? 4,
        maxRetries: overrides?.maxRetries ?? 2,
        retryBackoffMs: overrides?.retryBackoffMs ?? 60_000,
        workerTimeoutMs: overrides?.workerTimeoutMs ?? 10 * MINUTE_MS,
        rates: { boredomPerMinute: 1, energyPerMinute: 1 },
      },
    });
  }

  /** 插入宠物：lastRunAt=0 → 距 clock.now 足够久 → 前推后必就绪 */
  async function addPet(id: string, tenantId: string, extra?: Partial<typeof pets.$inferInsert>) {
    await db
      .insert(pets)
      .values({ id, tenantId, name: id, lastRunAt: 0, boredom: 60, energy: 60, ...extra })
      .run();
  }

  async function getPet(id: string) {
    return db.select().from(pets).where(eq(pets.id, id)).get();
  }

  /** 推进时钟 + 跑一轮 tick（等所有在飞 runner 结束） */
  async function tick(advanceMs = 0) {
    clock.now += advanceMs;
    await sched.runOnce();
    await sched.drain(); // 等在飞任务落定
  }

  it('就绪宠物被拉起一次，跑完写回 SQLite（lastRunAt/boredom/energy）', async () => {
    await addPet('p1', 't1');
    await tick();

    expect(runner).toHaveBeenCalledOnce();
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        petId: 'p1',
        dataDir: join(dataDir, 'tenants', 't1'), // 租户目录，非控制面根
      }),
    );

    const pet = await getPet('p1');
    expect(pet?.lastRunAt).toBe(clock.now);
    expect(pet?.boredom).toBe(60 + 10 - 50); // 前推 10 分钟 → 70，游荡 -50
    expect(pet?.energy).toBe(60 + 10 - 30); // 70 - 30

    // 事件发布到租户通道
    const events: string[] = [];
    bus.subscribe('t1', (e) => events.push(e.type));
    // 再 tick：lastRunAt 已更新、前推归零 → 不再就绪
    await tick();
    expect(runner).toHaveBeenCalledOnce();
    expect(events).toEqual([]);
  });

  it('未就绪（无聊不足）不拉起', async () => {
    await addPet('p1', 't1', { lastRunAt: clock.now, boredom: 10, energy: 60 });
    await tick();
    expect(runner).not.toHaveBeenCalled();
  });

  it('paused 跳过', async () => {
    await addPet('p1', 't1', { status: 'paused' });
    await tick();
    expect(runner).not.toHaveBeenCalled();
  });

  it('并发上限：maxConcurrent=2 时第三只不被拉起', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    runner.mockImplementation(async () => {
      await gate;
      return { ok: true, exitCode: 0 };
    });
    sched = makeScheduler({ maxConcurrent: 2 });
    await addPet('p1', 't1');
    await addPet('p2', 't2');
    await getOrCreateTenant(dataDir, 't3');
    await addPet('p3', 't3');

    await sched.runOnce(); // 不 drain：任务在飞
    expect(runner).toHaveBeenCalledTimes(2);
    expect(sched.runningCount()).toBe(2);

    release();
    await sched.drain();
  });

  it('崩溃重试：失败→退避后下一 tick 重拉→成功写回', async () => {
    await addPet('p1', 't1');
    runner.mockResolvedValueOnce({ ok: false, exitCode: 1 }).mockResolvedValueOnce({
      ok: true,
      exitCode: 0,
    });

    await tick(); // 第一次：失败
    expect(runner).toHaveBeenCalledOnce();
    const pet1 = await getPet('p1');
    expect(pet1?.lastRunAt).toBe(0); // 失败不写回

    await tick(1); // 退避未到：不重试
    expect(runner).toHaveBeenCalledOnce();

    await tick(60_000); // 退避到：重试成功
    expect(runner).toHaveBeenCalledTimes(2);
    const pet2 = await getPet('p1');
    expect(pet2?.lastRunAt).toBe(clock.now);
  });

  it('重试超限：放弃并 DB 冷却（cooldownUntil + 自洽状态，重启安全）', async () => {
    sched = makeScheduler({ maxRetries: 1, retryBackoffMs: 60_000 });
    await addPet('p1', 't1');
    runner.mockResolvedValue({ ok: false, exitCode: 1 });

    const failures: string[] = [];
    bus.subscribe('t1', (e) => {
      if (e.type === 'worker_failed') failures.push(e.type);
    });

    await tick(); // 第 1 次失败 → 排队重试
    await tick(60_000); // 重试失败 → 超限放弃
    expect(runner).toHaveBeenCalledTimes(2);
    expect(failures).toHaveLength(1);

    const pet = await getPet('p1');
    // 冷却：cooldownUntil 已设 + 状态自洽（前推值扣游荡量 + 基线重置）
    // 此时 clock = 首发 10min + 退避 1min = 11min 前推
    expect(pet?.cooldownUntil).toBe(clock.now + 60_000); // failAt + retryBackoffMs
    expect(pet?.lastRunAt).toBe(clock.now);
    expect(pet?.boredom).toBe(60 + 11 - 50); // 前推 11 分钟 → 71，扣 50
    expect(pet?.energy).toBe(60 + 11 - 30); // 71 - 30

    await tick(60_000); // 冷却恰好到期：无聊 21+1 仍不足 → 不拉
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('挂死 runner：超过 TTL 视为死亡，可重新认领', async () => {
    sched = makeScheduler({ workerTimeoutMs: 5 * MINUTE_MS });
    await addPet('p1', 't1');
    const hung = new Promise<{ ok: boolean; exitCode: number }>(() => {}); // 永不落定
    runner.mockImplementationOnce(() => hung).mockResolvedValueOnce({ ok: true, exitCode: 0 });

    await sched.runOnce(); // 拉起，卡住（不 drain）
    expect(sched.runningCount()).toBe(1);

    await sched.runOnce(); // TTL 内：占用中，不重复拉
    expect(runner).toHaveBeenCalledOnce();

    await sched.runOnce(); // 不推进时钟仍占
    clock.now += 6 * MINUTE_MS;
    await sched.runOnce(); // TTL 过：重新认领
    expect(runner).toHaveBeenCalledTimes(2);
    // 不 drain：挂死 promise 永不落定，靠 stop() 收尾
  });

  it('跨租户宠物各自拉起且事件不串', async () => {
    await addPet('p1', 't1');
    await addPet('p2', 't2');
    const t1Events: string[] = [];
    const t2Events: string[] = [];
    bus.subscribe('t1', (e) => {
      if (e.type === 'worker_started') t1Events.push(e.petId);
    });
    bus.subscribe('t2', (e) => {
      if (e.type === 'worker_started') t2Events.push(e.petId);
    });

    await tick();
    expect(runner).toHaveBeenCalledTimes(2);
    expect(t1Events).toEqual(['p1']);
    expect(t2Events).toEqual(['p2']);
  });

  describe('性格（#90）：行为参数按性格解析', () => {
    it('好奇无聊增速快于慵懒：同起点同流逝，好奇就绪、慵懒未就绪（acceptance）', async () => {
      // 基准 rates 1/1 × 性格倍率：好奇 1.0 → 60+10=70（就绪）；慵懒 0.6 → 60+6=66（未就绪）
      await addPet('curious-pet', 't1', { personality: 'curious' });
      await addPet('lazy-pet', 't2', { personality: 'lazy' });

      await tick();

      expect(runner).toHaveBeenCalledTimes(1);
      expect(runner).toHaveBeenCalledWith(expect.objectContaining({ petId: 'curious-pet' }));
    });

    it('runner 收到 personality，游荡写回按性格效果（活泼耗能更多）', async () => {
      await addPet('p1', 't1', { personality: 'playful' });
      await tick();

      expect(runner).toHaveBeenCalledWith(
        expect.objectContaining({ petId: 'p1', personality: 'playful' }),
      );
      const pet = await getPet('p1');
      // 前推：60+10×1.25=72.5，60+10×0.9=69；写回扣活泼效果（relief 55 / cost 35）
      expect(pet?.boredom).toBe(Math.round(72.5 - 55));
      expect(pet?.energy).toBe(Math.round(69 - 35));
    });

    it('存量宠物默认好奇 → 写回与改动前一致（relief 50 / cost 30）', async () => {
      await addPet('p1', 't1'); // 不传 personality：DB 默认 curious
      await tick();
      const pet = await getPet('p1');
      expect(pet?.personality).toBe('curious');
      expect(pet?.boredom).toBe(60 + 10 - 50);
      expect(pet?.energy).toBe(60 + 10 - 30);
    });
  });
});
