/**
 * 微信推送网关测试（#97）——限额/降级/状态门控
 *
 * 契约：
 * - 通道限额 = min(套餐每日上限, 8)；超限 → 跳过微信投递（降级其他已绑
 *   通道：飞书/TG/PWA 独立投递，不拦截）
 * - 跨天重置：pushesDate != 今天 → 计数重置
 * - 只推 active：paired/expired 跳过；24h 无交互 → 翻 expired 并跳过
 * - 会话失效（ret=-2 unknown）→ 标记 expired
 * - 无内容/无 token 跳过
 */

import { describe, it, expect, afterEach } from 'vitest';
import { rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getDb, _resetDb } from '../db/client.js';
import { eq } from 'drizzle-orm';
import { tenants, wechatBindings } from '../db/schema.js';
import { provisionWechatTenant } from './bindings.js';
import { cacheContextToken, wechatDataDir } from './chat-history.js';
import { createWechatPushGateway } from './wechat-gateway.js';
import { mockIlinkClient, sentMessages, setupTestDataDir } from './test-helpers.js';
import type { EventBus } from '../events/bus.js';
import { createEventBus } from '../events/bus.js';
import type { TenantEvent } from '../events/bus.js';

const CONFIRMED = {
  status: 'confirmed',
  bot_token: 'v1_bot_token',
  ilink_bot_id: 'bot123@im.bot',
  baseurl: 'https://ilinkai.weixin.qq.com',
  ilink_user_id: 'owner@im.wechat',
} as const;

const OWNER = 'owner@im.wechat';

/** 写一条可通知 speak（notifiable：gated/planLimited 未标） */
function seedSpeak(dataDir: string, tenantId: string, content: string): void {
  const dir = join(wechatDataDir(dataDir, tenantId), '..', 'history');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'speaks-2026-08-20.jsonl'),
    `${JSON.stringify({ content, type: 'share', pushed: false, timestamp: new Date().toISOString(), title: '标题', summary: '摘要' })}\n`,
    'utf8',
  );
}

/** 种子：绑定 + active + 缓存 context token + speaks */
async function seedActiveTenant(dataDir: string, opts: { plan?: 'free' | 'pro' | 'byok' } = {}): Promise<string> {
  const result = await provisionWechatTenant(dataDir, CONFIRMED as never);
  const tenantId = result.tenantId;
  const db = await getDb(dataDir);
  await db.update(tenants).set({ plan: opts.plan ?? 'free' }).where(eq(tenants.id, tenantId)).run();
  await db
    .update(wechatBindings)
    .set({ status: 'active', lastInteractionAt: Date.now() })
    .where(eq(wechatBindings.tenantId, tenantId))
    .run();
  await cacheContextToken(dataDir, tenantId, OWNER, 'latest-ctx');
  return tenantId;
}

function workerEvent(tenantId: string): TenantEvent {
  return { type: 'worker_succeeded', tenantId, petId: 'pet-1', at: Date.now() };
}

describe('微信推送网关（限额/降级/门控）', () => {
  let dataDir: string;

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('free 套餐：限额 = min(5, 8) = 5；超限跳过（降级其他通道）', async () => {
    dataDir = await setupTestDataDir();
    const tenantId = await seedActiveTenant(dataDir, { plan: 'free' });
    seedSpeak(dataDir, tenantId, '今天的发现');

    const bus: EventBus = createEventBus();
    const { client, calls } = mockIlinkClient(() => ({ ret: 0 }));
    const gateway = createWechatPushGateway({
      dataDir,
      bus,
      clientFactory: () => client,
      todayFn: () => '2026-08-20',
    });

    for (let i = 0; i < 5; i++) {
      const result = await gateway.dispatch(workerEvent(tenantId));
      expect(result.sent).toBe(true);
    }
    expect(sentMessages(calls)).toHaveLength(5);

    // 第 6 次 → 额度用尽
    const over = await gateway.dispatch(workerEvent(tenantId));
    expect(over).toEqual({ skipped: true, reason: 'quota_exhausted' });
    expect(sentMessages(calls)).toHaveLength(5); // 不再发送

    const db = await getDb(dataDir);
    const binding = await db.select().from(wechatBindings).where(eq(wechatBindings.tenantId, tenantId)).get();
    expect(binding?.pushesCount).toBe(5);
    expect(binding?.pushesDate).toBe('2026-08-20');
  });

  it('pro 套餐：限额 = min(20, 8) = 8（官方 10 条留 20% 余量）', async () => {
    dataDir = await setupTestDataDir();
    const tenantId = await seedActiveTenant(dataDir, { plan: 'pro' });
    seedSpeak(dataDir, tenantId, 'pro 内容');

    const bus = createEventBus();
    const { client, calls } = mockIlinkClient(() => ({ ret: 0 }));
    const gateway = createWechatPushGateway({
      dataDir,
      bus,
      clientFactory: () => client,
      todayFn: () => '2026-08-20',
    });

    for (let i = 0; i < 8; i++) {
      await gateway.dispatch(workerEvent(tenantId));
    }
    expect(sentMessages(calls)).toHaveLength(8);
    const over = await gateway.dispatch(workerEvent(tenantId));
    expect(over.reason).toBe('quota_exhausted');
  });

  it('跨天重置：pushesDate 昨天 → 计数归零重新计数', async () => {
    dataDir = await setupTestDataDir();
    const tenantId = await seedActiveTenant(dataDir);
    seedSpeak(dataDir, tenantId, '跨天内容');
    const db = await getDb(dataDir);
    await db
      .update(wechatBindings)
      .set({ pushesDate: '2026-08-19', pushesCount: 5 })
      .where(eq(wechatBindings.tenantId, tenantId))
      .run();

    const bus = createEventBus();
    const { client, calls } = mockIlinkClient(() => ({ ret: 0 }));
    const gateway = createWechatPushGateway({
      dataDir,
      bus,
      clientFactory: () => client,
      todayFn: () => '2026-08-20',
    });

    await gateway.dispatch(workerEvent(tenantId));
    expect(sentMessages(calls)).toHaveLength(1);
    const binding = await db.select().from(wechatBindings).where(eq(wechatBindings.tenantId, tenantId)).get();
    expect(binding?.pushesCount).toBe(1);
    expect(binding?.pushesDate).toBe('2026-08-20');
  });

  it('paired/expired 不推内容；24h 无交互 → 翻 expired 并跳过', async () => {
    dataDir = await setupTestDataDir();
    const result = await provisionWechatTenant(dataDir, CONFIRMED as never); // paired
    const tenantId = result.tenantId;
    seedSpeak(dataDir, tenantId, '未激活内容');

    const bus = createEventBus();
    const { client, calls } = mockIlinkClient(() => ({ ret: 0 }));
    const gateway = createWechatPushGateway({
      dataDir,
      bus,
      clientFactory: () => client,
      todayFn: () => '2026-08-20',
    });

    // paired → 跳过（激活前不推内容）
    const pairedResult = await gateway.dispatch(workerEvent(tenantId));
    expect(pairedResult).toEqual({ skipped: true, reason: 'not_active' });
    expect(calls).toHaveLength(0);

    // active 但 24h 无交互 → 翻 expired + 跳过
    const db = await getDb(dataDir);
    await db
      .update(wechatBindings)
      .set({ status: 'active', lastInteractionAt: Date.now() - 25 * 60 * 60 * 1000 })
      .where(eq(wechatBindings.tenantId, tenantId))
      .run();
    await cacheContextToken(dataDir, tenantId, OWNER, 'ctx');
    const staleResult = await gateway.dispatch(workerEvent(tenantId));
    expect(staleResult).toEqual({ skipped: true, reason: 'session_expired' });
    const binding = await db.select().from(wechatBindings).where(eq(wechatBindings.tenantId, tenantId)).get();
    expect(binding?.status).toBe('expired');
    expect(calls).toHaveLength(0);
  });

  it('会话失效（ret=-2 unknown error）→ 标记 expired', async () => {
    dataDir = await setupTestDataDir();
    const tenantId = await seedActiveTenant(dataDir);
    seedSpeak(dataDir, tenantId, '会失效的内容');

    const bus = createEventBus();
    const { client } = mockIlinkClient(() => ({ ret: -2, errmsg: 'unknown error' }));
    const gateway = createWechatPushGateway({
      dataDir,
      bus,
      clientFactory: () => client,
      todayFn: () => '2026-08-20',
    });

    await expect(gateway.dispatch(workerEvent(tenantId))).rejects.toThrow();
    const db = await getDb(dataDir);
    const binding = await db.select().from(wechatBindings).where(eq(wechatBindings.tenantId, tenantId)).get();
    expect(binding?.status).toBe('expired');
    expect(binding?.lastError).toContain('会话失效');
  });

  it('P2 回归：发送失败（非会话失效）→ 退还额度，下次事件可重试', async () => {
    dataDir = await setupTestDataDir();
    const tenantId = await seedActiveTenant(dataDir);
    seedSpeak(dataDir, tenantId, '会失败的内容');

    const bus = createEventBus();
    const { client } = mockIlinkClient(() => ({ ret: -3, errmsg: 'bad param' }));
    const gateway = createWechatPushGateway({
      dataDir,
      bus,
      clientFactory: () => client,
      todayFn: () => '2026-08-20',
    });

    await expect(gateway.dispatch(workerEvent(tenantId))).rejects.toThrow();
    const db = await getDb(dataDir);
    const binding = await db.select().from(wechatBindings).where(eq(wechatBindings.tenantId, tenantId)).get();
    // 额度已退还：计数归 0（当日键仍在，下次 claim 从 1 起）
    expect(binding?.pushesCount).toBe(0);
    expect(binding?.pushesDate).toBe('2026-08-20');

    // 失败后重试仍可扣额成功
    const { client: ok } = mockIlinkClient(() => ({ ret: 0 }));
    const gateway2 = createWechatPushGateway({
      dataDir,
      bus,
      clientFactory: () => ok,
      todayFn: () => '2026-08-20',
    });
    const retry = await gateway2.dispatch(workerEvent(tenantId));
    expect(retry.sent).toBe(true);
  });

  it('P2 回归：context_token 缺失 → 不 claim 不扣额度', async () => {
    dataDir = await setupTestDataDir();
    const tenantId = await seedActiveTenant(dataDir);
    seedSpeak(dataDir, tenantId, '无 token 内容');
    // 清空 context_token 缓存（active 态防御性跳过）
    writeFileSync(join(wechatDataDir(dataDir, tenantId), 'context-tokens.json'), '{}', 'utf8');

    const bus = createEventBus();
    const { client, calls } = mockIlinkClient(() => ({ ret: 0 }));
    const gateway = createWechatPushGateway({
      dataDir,
      bus,
      clientFactory: () => client,
      todayFn: () => '2026-08-20',
    });
    const result = await gateway.dispatch(workerEvent(tenantId));
    expect(result).toEqual({ skipped: true, reason: 'no_token' });
    expect(calls).toHaveLength(0); // 未发起发送
    const db = await getDb(dataDir);
    const binding = await db.select().from(wechatBindings).where(eq(wechatBindings.tenantId, tenantId)).get();
    expect(binding?.pushesCount).toBe(0); // 未扣额度
  });

  it('事件类型过滤：worker_succeeded 之外忽略', async () => {
    dataDir = await setupTestDataDir();
    const tenantId = await seedActiveTenant(dataDir);
    seedSpeak(dataDir, tenantId, 'x');
    const bus = createEventBus();
    const { client, calls } = mockIlinkClient(() => ({ ret: 0 }));
    const gateway = createWechatPushGateway({
      dataDir,
      bus,
      clientFactory: () => client,
      todayFn: () => '2026-08-20',
    });
    const result = await gateway.dispatch({ type: 'worker_started', tenantId, petId: 'p', at: 1 } as TenantEvent);
    expect(result.skipped).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('挂总线：worker_succeeded 自动分发（attach 后事件驱动）', async () => {
    dataDir = await setupTestDataDir();
    const tenantId = await seedActiveTenant(dataDir);
    seedSpeak(dataDir, tenantId, '总线内容');
    const bus = createEventBus();
    const { client, calls } = mockIlinkClient(() => ({ ret: 0 }));
    const gateway = createWechatPushGateway({
      dataDir,
      bus,
      clientFactory: () => client,
      todayFn: () => '2026-08-20',
    });
    const detach = gateway.attach();
    try {
      bus.publish(tenantId, workerEvent(tenantId));
      // 等事件驱动的异步分发落定（不猜时长）
      await gateway.drain();
      expect(sentMessages(calls).length).toBeGreaterThanOrEqual(1);
    } finally {
      detach();
    }
  });
});
