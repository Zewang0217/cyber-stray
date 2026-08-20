/**
 * push-gateway 测试（S10，#77）
 *
 * 契约：
 * - worker_succeeded 事件 → 读该租户 speaks 历史最新一条 pushed 记录
 *   → 向该租户全部订阅发 Web Push 通知
 * - 每设备 lastNotifiedAt 去重：内容早于上次已通知时间则跳过
 * - 发送失败（404/410 端点失效）→ 删除订阅行；其他失败保留重试
 * - 非推送类事件（worker_failed 等）不触发通知
 * - 租户隔离：只发给事件租户的订阅
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { pets, pushSubscriptions } from '../db/schema.js';
import { getOrCreateTenant, tenantDataDir } from '../tenant.js';
import { createEventBus, type TenantEvent } from '../events/bus.js';
import { attachPushGateway, type PushSendFn } from './push-gateway.js';
import webpush from 'web-push';

describe('push-gateway（Web Push 分发）', () => {
  let dataDir: string;
  let sent: Array<{ endpoint: string; payload: unknown }>;
  let sendFn: PushSendFn;
  let unsub: () => void;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-gateway-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    await getOrCreateTenant(dataDir, 'bob');
    sent = [];
    sendFn = async (endpoint, payload) => {
      sent.push({ endpoint, payload });
    };
  });

  afterEach(() => {
    unsub?.();
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function seedSubscription(tenantId: string, endpoint: string): Promise<void> {
    const db = await getDb(dataDir);
    await db
      .insert(pushSubscriptions)
      .values({
        id: `sub-${endpoint.slice(-6)}`,
        tenantId,
        endpoint,
        p256dh: 'BKey',
        auth: 'AKey',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();
  }

  async function seedSpeaks(tenantId: string, record: Record<string, unknown>): Promise<void> {
    const dir = tenantDataDir(dataDir, tenantId);
    mkdirSync(join(dir, 'history'), { recursive: true });
    const file = join(dir, 'history', 'speaks-2026-08-15.jsonl');
    writeFileSync(file, JSON.stringify(record) + '\n', { encoding: 'utf-8' });
  }

  function ev(type: TenantEvent['type'], tenantId: string): TenantEvent {
    return { type, tenantId, petId: 'pet-1', at: Date.now() };
  }

  it('worker_succeeded → 最新 pushed 推送发通知给本租户订阅', async () => {
    const bus = createEventBus();
    unsub = attachPushGateway({
      dataDir,
      bus,
      sendFn,
      getKeys: async () => {
        const g = webpush.generateVAPIDKeys();
        return { publicKey: g.publicKey, privateKey: g.privateKey };
      },
    });
    await seedSubscription('alice', 'https://push.example/a1');
    await seedSubscription('bob', 'https://push.example/b1');
    await seedSpeaks('alice', {
      content: '量子计算新突破',
      type: 'share',
      pushed: true,
      timestamp: '2026-08-15T12:00:00.000Z',
      title: '量子计算新突破',
      summary: '摘要',
    });

    bus.publish('alice', ev('worker_succeeded', 'alice'));
    await new Promise((r) => setTimeout(r, 50));

    expect(sent).toHaveLength(1); // bob 不收
    expect(sent[0]?.endpoint).toBe('https://push.example/a1');
    const payload = sent[0]?.payload as { title: string; body: string; url?: string };
    expect(payload.title).toBe('街溜子有新发现');
    expect(payload.body).toBe('量子计算新突破');
  });

  it('lastNotifiedAt 去重：内容不晚于上次通知则跳过', async () => {
    const bus = createEventBus();
    unsub = attachPushGateway({
      dataDir,
      bus,
      sendFn,
      getKeys: async () => {
        const g = webpush.generateVAPIDKeys();
        return { publicKey: g.publicKey, privateKey: g.privateKey };
      },
    });
    const db = await getDb(dataDir);
    await seedSubscription('alice', 'https://push.example/a1');
    // 上次已通知到现在 → 新内容时间戳早于它
    await db
      .update(pushSubscriptions)
      .set({ lastNotifiedAt: Date.now() })
      .where(eq(pushSubscriptions.endpoint, 'https://push.example/a1'))
      .run();
    await seedSpeaks('alice', {
      content: '旧内容',
      pushed: true,
      timestamp: '2026-08-14T00:00:00.000Z',
    });

    bus.publish('alice', ev('worker_succeeded', 'alice'));
    await new Promise((r) => setTimeout(r, 50));

    expect(sent).toHaveLength(0);
  });

  it('发送成功更新 lastNotifiedAt；404/410 端点失效删订阅', async () => {
    const bus = createEventBus();
    sendFn = async () => {
      throw Object.assign(new Error('gone'), { statusCode: 410 });
    };
    unsub = attachPushGateway({
      dataDir,
      bus,
      sendFn,
      getKeys: async () => {
        const g = webpush.generateVAPIDKeys();
        return { publicKey: g.publicKey, privateKey: g.privateKey };
      },
    });
    await seedSubscription('alice', 'https://push.example/dead');
    await seedSpeaks('alice', {
      content: '内容',
      pushed: true,
      timestamp: new Date().toISOString(),
    });

    bus.publish('alice', ev('worker_succeeded', 'alice'));
    await new Promise((r) => setTimeout(r, 50));

    const db = await getDb(dataDir);
    const rows = await db.select().from(pushSubscriptions).all();
    expect(rows).toHaveLength(0); // 410 → 清理死订阅
  });

  it('非 worker_succeeded 事件不触发；无 speaks 历史不炸不通知', async () => {
    const bus = createEventBus();
    unsub = attachPushGateway({
      dataDir,
      bus,
      sendFn,
      getKeys: async () => {
        const g = webpush.generateVAPIDKeys();
        return { publicKey: g.publicKey, privateKey: g.privateKey };
      },
    });
    await seedSubscription('alice', 'https://push.example/a1');

    bus.publish('alice', ev('worker_failed', 'alice'));
    bus.publish('alice', ev('worker_succeeded', 'alice')); // 无历史文件
    await new Promise((r) => setTimeout(r, 50));

    expect(sent).toHaveLength(0);
  });

  it('#92 diary_generated → 日记 speak 记录（pushed=false, diary=true）经 Web Push 送达', async () => {
    const bus = createEventBus();
    unsub = attachPushGateway({
      dataDir,
      bus,
      sendFn,
      getKeys: async () => {
        const g = webpush.generateVAPIDKeys();
        return { publicKey: g.publicKey, privateKey: g.privateKey };
      },
    });
    await seedSubscription('alice', 'https://push.example/a1');
    // 日记 worker 写的 notifiable 记录：pushed=false（PWA 默认通道）+ diary=true
    await seedSpeaks('alice', {
      content: '# 日记 · 2026-08-15\n\n今天发现了量子计算',
      type: 'article',
      pushed: false,
      timestamp: '2026-08-15T23:59:59.000Z',
      title: '日记 · 2026-08-15',
      gated: false,
      planLimited: false,
      diary: true,
    });

    bus.publish('alice', ev('diary_generated', 'alice'));
    await new Promise((r) => setTimeout(r, 50));

    expect(sent).toHaveLength(1);
    const payload = sent[0]?.payload as { title: string; body: string };
    expect(payload.title).toBe('街溜子有新发现');
    expect(payload.body).toContain('日记 · 2026-08-15');
  });

  it('S11 planLimited 记录不可通知（预算/窗口拦下的内容 Web Push 不绕过）', async () => {
    const bus = createEventBus();
    unsub = attachPushGateway({
      dataDir,
      bus,
      sendFn,
      getKeys: async () => {
        const g = webpush.generateVAPIDKeys();
        return { publicKey: g.publicKey, privateKey: g.privateKey };
      },
    });
    await seedSubscription('alice', 'https://push.example/a1');
    await seedSpeaks('alice', {
      content: '预算外文章',
      type: 'article',
      pushed: false,
      planLimited: true,
      timestamp: '2026-08-15T12:00:00.000Z',
      title: '预算外文章',
      summary: '摘要',
    });

    bus.publish('alice', ev('worker_succeeded', 'alice'));
    await new Promise((r) => setTimeout(r, 50));
    expect(sent).toHaveLength(0);
  });

  it('S11 推送窗口外不发（pets 行窗口；窗口内正常发）', async () => {
    const db = await getDb(dataDir);
    // 窗口 = 当前小时 ±1（必含当前小时）→ 应发
    const nowHour = new Date().getHours();
 await db
      .insert(pets)
      .values({
        id: 'pet-alice',
        tenantId: 'alice',
        name: '小溜',
        pushWindowStart: (nowHour + 23) % 24,
        pushWindowEnd: (nowHour + 1) % 24,
      })
      .run();

    const bus = createEventBus();
    unsub = attachPushGateway({
      dataDir,
      bus,
      sendFn,
      getKeys: async () => {
        const g = webpush.generateVAPIDKeys();
        return { publicKey: g.publicKey, privateKey: g.privateKey };
      },
    });
    await seedSubscription('alice', 'https://push.example/a1');
    await seedSpeaks('alice', {
      content: '窗口内内容',
      type: 'share',
      timestamp: '2026-08-15T12:00:00.000Z',
      title: '窗口内内容',
      summary: '摘要',
    });

    bus.publish('alice', ev('worker_succeeded', 'alice'));
    await new Promise((r) => setTimeout(r, 50));
    expect(sent).toHaveLength(1);

    // 窗口改为绝不含当前小时（start=end+2 的两小时窗，挪到对面）
    const opposite1 = (nowHour + 6) % 24;
    const opposite2 = (nowHour + 7) % 24;
    await db
      .update(pets)
      .set({ pushWindowStart: opposite1, pushWindowEnd: opposite2 })
      .where(eq(pets.tenantId, 'alice'))
      .run();
    sent.length = 0;
    // 重置订阅基线让下一条内容可发
    await db
      .update(pushSubscriptions)
      .set({ lastNotifiedAt: null })
      .where(eq(pushSubscriptions.endpoint, 'https://push.example/a1'))
      .run();
    await seedSpeaks('alice', {
      content: '窗口外内容',
      type: 'share',
      timestamp: '2026-08-15T13:00:00.000Z',
      title: '窗口外内容',
      summary: '摘要',
    });

    bus.publish('alice', ev('worker_succeeded', 'alice'));
    await new Promise((r) => setTimeout(r, 50));
    expect(sent).toHaveLength(0);
  });
});
