/**
 * 自助注销路由测试：宠物名确认、软删生效（含 requireTenant 拒绝已注销
 * session 的集成验证）、成功清 session cookie。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant } from '../infra/tenant.js';
import { signSession, SESSION_COOKIE } from '../auth/session.js';
import { pets, tenants } from '../db/schema.js';
import { createAccountRoutes } from './account.js';

const SECRET = 'x'.repeat(40);

describe('DELETE /api/account（自助注销）', () => {
  let dataDir: string;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-account-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    await getOrCreateTenant(dataDir, 'norpet'); // 未领养用户
    const db = await getDb(dataDir);
    await db.insert(pets).values({
      id: 'pet-a', tenantId: 'alice', name: '小溜', status: 'active',
    }).run();
    app = new Hono();
    app.route('/api/account', createAccountRoutes({ config: { dataDir, sessionSecret: SECRET, adminSubs: [] } }));
  });

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function authed(
    body: unknown,
    claims = { sub: 'alice', tenantId: 'alice' },
  ): Promise<Request> {
    const token = await signSession(claims, SECRET);
    return new Request('http://x/api/account', {
      method: 'DELETE',
      headers: { cookie: `${SESSION_COOKIE}=${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('未登录 → 401', async () => {
    const res = await app.request('http://x/api/account', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmPetName: '小溜' }),
    });
    expect(res.status).toBe(401);
  });

  it('宠物名匹配 → 200：软删 + 宠物停派 + 清 session cookie', async () => {
    const res = await app.request(await authed({ confirmPetName: '小溜', reason: '再见' }));
    expect(res.status).toBe(200);
    // cookie 即刻清除（与 logout 同口）
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`${SESSION_COOKIE}=`));
    const db = await getDb(dataDir);
    const t = await db.select().from(tenants).where(eq(tenants.id, 'alice')).get();
    expect(t?.deletedAt).not.toBeNull();
    expect(t?.deletionMode).toBe('self');
    expect(t?.deletionReason).toBe('再见');
    expect((await db.select().from(pets).where(eq(pets.tenantId, 'alice')).get())?.status).toBe('paused');
  });

  it('宠物名不匹配 → 400，账号不变', async () => {
    const res = await app.request(await authed({ confirmPetName: '阿黄' }));
    expect(res.status).toBe(400);
    const db = await getDb(dataDir);
    expect((await db.select().from(tenants).where(eq(tenants.id, 'alice')).get())?.deletedAt).toBeNull();
  });

  it('未领养用户：输入「注销」二字放行，其他 400', async () => {
    const claims = { sub: 'norpet', tenantId: 'norpet' };
    expect((await app.request(await authed({ confirmPetName: '小溜' }, claims))).status).toBe(400);
    const res = await app.request(await authed({ confirmPetName: '注销' }, claims));
    expect(res.status).toBe(200);
    const db = await getDb(dataDir);
    expect((await db.select().from(tenants).where(eq(tenants.id, 'norpet')).get())?.deletedAt).not.toBeNull();
  });

  it('注销后旧 session 再访问 → 403 账号已注销（requireTenant 软删拒绝）', async () => {
    const request = await authed({ confirmPetName: '小溜' });
    expect((await app.request(request)).status).toBe(200);
    // 同一 session 再来一次：鉴权层先拒绝
    const again = await app.request(await authed({ confirmPetName: '小溜' }));
    expect(again.status).toBe(403);
    expect(((await again.json()) as { error: string }).error).toBe('账号已注销');
  });
});
