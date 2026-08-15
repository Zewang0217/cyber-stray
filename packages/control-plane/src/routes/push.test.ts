/**
 * push 路由测试（S10，#77）
 *
 * 契约：
 * - GET /api/push/vapid-key：公开（浏览器订阅前拿公钥）；未生成分配单例
 * - POST /api/push/subscribe：鉴权 + 租户校验；endpoint 幂等（重复订阅
 *   覆盖归属与密钥——换租户重新订阅即改归属）；同租户重复刷新密钥
 * - DELETE /api/push/subscribe：按 endpoint 退订；只删本租户的订阅
 * - 租户只由 session claim 决定（x-tenant-* 忽略）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { pushSubscriptions, vapidKeys } from '../db/schema.js';
import { getOrCreateTenant } from '../tenant.js';
import { signSession, SESSION_COOKIE } from '../session.js';
import { createPushRoutes } from './push.js';

const SECRET = 'x'.repeat(40);

/** 合法订阅体（结构与浏览器 PushSubscription.toJSON() 对齐） */
const SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: 'BPubKey', auth: 'AuthKey' },
};

describe('push 路由（Web Push 订阅管理）', () => {
  let dataDir: string;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-push-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    await getOrCreateTenant(dataDir, 'bob');
    app = new Hono();
    const config = { dataDir, sessionSecret: SECRET } as Parameters<
      typeof createPushRoutes
    >[0]['config'];
    app.route('/api/push', createPushRoutes({ config }));
  });

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function authed(
    url: string,
    init: RequestInit = {},
    claims = { sub: 'alice', tenantId: 'alice' },
  ): Promise<Request> {
    const token = await signSession(claims, SECRET);
    const headers = new Headers(init.headers);
    headers.set('cookie', `${SESSION_COOKIE}=${token}`);
    headers.set('content-type', 'application/json');
    headers.set('x-tenant-id', 'bob'); // 越权尝试：必须被忽略
    return new Request(url, { ...init, headers });
  }

  it('GET /api/push/vapid-key：公开返回公钥；单例行稳定（两次一致）', async () => {
    const res1 = await app.request('/api/push/vapid-key');
    expect(res1.status).toBe(200);
    const json1 = (await res1.json()) as { success: boolean; data: { publicKey: string } };
    expect(json1.success).toBe(true);
    expect(json1.data.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);

    const res2 = await app.request('/api/push/vapid-key');
    const json2 = (await res2.json()) as { data: { publicKey: string } };
    expect(json2.data.publicKey).toBe(json1.data.publicKey);

    const db = await getDb(dataDir);
    const rows = await db.select().from(vapidKeys).all();
    expect(rows).toHaveLength(1);
  });

  it('POST /api/push/subscribe：建订阅行（归属 session 租户，lastNotifiedAt 种子=now 防追发历史）', async () => {
    const req = await authed('http://x/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(SUB),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);

    const db = await getDb(dataDir);
    const row = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, SUB.endpoint))
      .get();
    expect(row?.tenantId).toBe('alice');
    expect(row?.p256dh).toBe('BPubKey');
    expect(row?.auth).toBe('AuthKey');
    // 种子：只通知订阅后的新内容，首次事件不追发历史
    expect(row?.lastNotifiedAt).not.toBeNull();
  });

  it('订阅幂等：同租户重复订阅刷新密钥；换租户订阅改归属', async () => {
    const req1 = await authed('http://x/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(SUB),
    });
    await app.request(req1);

    // 同租户重复订阅（浏览器续订，密钥可能更新）
    const req2 = await authed('http://x/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ ...SUB, keys: { p256dh: 'BNew', auth: 'ANew' } }),
    });
    const res2 = await app.request(req2);
    expect(res2.status).toBe(200); // 更新而非新建

    const db = await getDb(dataDir);
    let rows = await db.select().from(pushSubscriptions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.p256dh).toBe('BNew');

    // bob 用同一 endpoint 订阅 → 归属转移（设备换账号）
    const req3 = await authed(
      'http://x/api/push/subscribe',
      { method: 'POST', body: JSON.stringify(SUB) },
      { sub: 'bob', tenantId: 'bob' },
    );
    await app.request(req3);
    rows = await db.select().from(pushSubscriptions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe('bob');
    // 换租户重置去重基线（新主人不收旧内容）
    expect(rows[0]?.lastNotifiedAt).not.toBeNull();
  });

  it('参数校验：缺 endpoint/keys/p256dh/auth → 400', async () => {
    for (const body of [
      JSON.stringify({ keys: SUB.keys }),
      JSON.stringify({ endpoint: SUB.endpoint }),
      JSON.stringify({ endpoint: SUB.endpoint, keys: { p256dh: 'B', auth: '' } }),
    ]) {
      const req = await authed('http://x/api/push/subscribe', { method: 'POST', body });
      expect((await app.request(req)).status).toBe(400);
    }
  });

  it('DELETE：退订本租户订阅；删他租户 endpoint → 404（不暴露存在性）', async () => {
    const req1 = await authed('http://x/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(SUB),
    });
    await app.request(req1);

    // bob 试图删 alice 的订阅
    const delBob = await authed(
      'http://x/api/push/subscribe',
      { method: 'DELETE', body: JSON.stringify({ endpoint: SUB.endpoint }) },
      { sub: 'bob', tenantId: 'bob' },
    );
    expect((await app.request(delBob)).status).toBe(404);

    const db = await getDb(dataDir);
    expect(await db.select().from(pushSubscriptions).all()).toHaveLength(1);

    const delAlice = await authed('http://x/api/push/subscribe', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint: SUB.endpoint }),
    });
    expect((await app.request(delAlice)).status).toBe(200);
    expect(await db.select().from(pushSubscriptions).all()).toHaveLength(0);
  });
});
