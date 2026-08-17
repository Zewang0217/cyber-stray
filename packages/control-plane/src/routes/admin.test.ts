import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant, tenantDataDir } from '../tenant.js';
import { signSession, SESSION_COOKIE } from '../session.js';
import { admins, pets, tenants } from '../db/schema.js';
import { createAdminRoutes } from './admin.js';

const SECRET = 'x'.repeat(40);

describe('admin 路由（用户级管理 + RBAC）', () => {
  let dataDir: string;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-admin-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'tenant-a');
    await getOrCreateTenant(dataDir, 'tenant-b');
    await getOrCreateTenant(dataDir, 'tenant-c'); // 无宠物用户
    const db = await getDb(dataDir);
    await db.insert(pets).values({
      id: 'pet-a1', tenantId: 'tenant-a', name: '小溜',
      status: 'active', boredom: 30, energy: 80,
    }).run();
    await db.insert(pets).values({
      id: 'pet-b1', tenantId: 'tenant-b', name: '阿黄',
      status: 'paused', boredom: 55, energy: 40,
    }).run();
    // 租户 b 已是 pro（账号级）
    await db.update(tenants).set({ plan: 'pro' }).where(eq(tenants.id, 'tenant-b')).run();
    // 两个有宠租户写 state 统计
    for (const [tid, w, p] of [['tenant-a', 11, 19], ['tenant-b', 3, 7]] as const) {
      const dir = tenantDataDir(dataDir, tid);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'state.json'), JSON.stringify({ totalWanders: w, totalPushes: p }));
    }

    app = new Hono();
    const config = {
      dataDir, sessionSecret: SECRET,
      adminSubs: ['admin-1'], // env bootstrap
    } as Parameters<typeof createAdminRoutes>[0]['config'];
    app.route('/api/admin', createAdminRoutes({ config }));
  });

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function authed(
    url: string,
    init: RequestInit = {},
    claims = { sub: 'admin-1', tenantId: 'tenant-a' },
  ): Promise<Request> {
    const token = await signSession(claims, SECRET);
    const headers = new Headers(init.headers);
    headers.set('cookie', `${SESSION_COOKIE}=${token}`);
    headers.set('content-type', 'application/json');
    return new Request(url, { ...init, headers });
  }

  it('GET /api/admin/users：列出全部用户（含无宠物用户），plan 来自账号层', async () => {
    const res = await app.request(await authed('http://x/api/admin/users'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(json.data).toHaveLength(3);
    const a = json.data.find((u) => u.tenantId === 'tenant-a');
    expect(a?.petName).toBe('小溜');
    expect(a?.plan).toBe('free');
    expect(a?.totalWanders).toBe(11);
    const b = json.data.find((u) => u.tenantId === 'tenant-b');
    expect(b?.plan).toBe('pro');
    const c = json.data.find((u) => u.tenantId === 'tenant-c');
    expect(c?.petName).toBeNull();
    expect(c?.plan).toBe('free');
  });

  it('PUT /api/admin/users/:id/plan：改用户套餐（账号层，非宠物层）', async () => {
    const res = await app.request(
      await authed('http://x/api/admin/users/tenant-a/plan', {
        method: 'PUT', body: JSON.stringify({ plan: 'pro' }),
      }),
    );
    expect(res.status).toBe(200);
    const db = await getDb(dataDir);
    const t = await db.select().from(tenants).where(eq(tenants.id, 'tenant-a')).get();
    expect(t?.plan).toBe('pro');
    // 宠物行 plan 列已废弃（S14 迁移），不应再读
    const pet = await db.select().from(pets).where(eq(pets.tenantId, 'tenant-a')).get();
    expect(pet?.plan).toBe('free');
  });

  it('RBAC：admins 表判定（非 env 白名单但入表）可访问', async () => {
    const db = await getDb(dataDir);
    await db.insert(admins).values({ sub: 'promoted-1', grantedBy: 'admin-1' }).run();
    const res = await app.request(
      await authed('http://x/api/admin/users', {}, { sub: 'promoted-1', tenantId: 'tenant-a' }),
    );
    expect(res.status).toBe(200);
  });

  it('RBAC：既非 env 白名单又非 admins 表 → 403', async () => {
    const res = await app.request(
      await authed('http://x/api/admin/users', {}, { sub: 'evil-user', tenantId: 'tenant-b' }),
    );
    expect(res.status).toBe(403);
  });

  it('GET /api/admin/admins：管理员列表；POST 添加（管理员授权）；DELETE 移除', async () => {
    // 列表（env bootstrap 的 admin-1 也应出现，来源 env）
    let res = await app.request(await authed('http://x/api/admin/admins'));
    expect(res.status).toBe(200);
    let json = (await res.json()) as { data: Array<{ sub: string }> };
    expect(json.data.map((a) => a.sub)).toContain('admin-1');

    // 添加新管理员
    res = await app.request(
      await authed('http://x/api/admin/admins', {
        method: 'POST', body: JSON.stringify({ sub: 'new-admin' }),
      }),
    );
    expect(res.status).toBe(200);
    const db = await getDb(dataDir);
    const row = await db.select().from(admins).where(eq(admins.sub, 'new-admin')).get();
    expect(row?.grantedBy).toBe('admin-1');

    // 新管理员现在可访问
    res = await app.request(
      await authed('http://x/api/admin/users', {}, { sub: 'new-admin', tenantId: 'tenant-a' }),
    );
    expect(res.status).toBe(200);

    // 移除
    res = await app.request(
      await authed('http://x/api/admin/admins/new-admin', { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    const gone = await db.select().from(admins).where(eq(admins.sub, 'new-admin')).get();
    expect(gone).toBeUndefined();
  });

  it('PUT /api/admin/users/:id/pet-status：暂停/恢复宠物', async () => {
    const res = await app.request(
      await authed('http://x/api/admin/users/tenant-a/pet-status', {
        method: 'PUT', body: JSON.stringify({ status: 'paused' }),
      }),
    );
    expect(res.status).toBe(200);
    const db = await getDb(dataDir);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, 'tenant-a')).get();
    expect(pet?.status).toBe('paused');
  });

  it('DELETE /admins：自撤 → 400；末位管理员（无 env 兜底）→ 400', async () => {
    const db = await getDb(dataDir);
    // 自撤
    const selfRevoke = await app.request(
      await authed('http://x/api/admin/admins/admin-1', { method: 'DELETE' }),
    );
    expect(selfRevoke.status).toBe(400);

    // app2：env 白名单为空（生产形态），admin-1 先入表才能操作
    const emptyEnvConfig = {
      dataDir, sessionSecret: SECRET, adminSubs: [],
    } as Parameters<typeof createAdminRoutes>[0]['config'];
    const app2 = new Hono();
    app2.route('/api/admin', createAdminRoutes({ config: emptyEnvConfig }));
    await db.insert(admins).values({ sub: 'admin-1', grantedBy: 'admin-1' }).run();
    // 表内仅 1 人（admin-1），撤销 promoted-1 不存在 → 404（且非末位保护生效场景）；
    // 正确场景：先给表加 1 人，撤销后剩 1 人 = 非末位 → 允许
    await db.insert(admins).values({ sub: 'promoted-1', grantedBy: 'admin-1' }).run();
    const ok = await app2.request(
      await authed('http://x/api/admin/admins/promoted-1', { method: 'DELETE' }, { sub: 'admin-1', tenantId: 'tenant-a' }),
    );
    expect(ok.status).toBe(200);

    // 末位保护：表内只剩 admin-1，撤销自己 → 400（自撤）
    const self2 = await app2.request(
      await authed('http://x/api/admin/admins/admin-1', { method: 'DELETE' }, { sub: 'admin-1', tenantId: 'tenant-a' }),
    );
    expect(self2.status).toBe(400);
  });

  it('PUT /api/admin/tenants/:id/plan 兼容旧路径（宠物级）不存在 → 404', async () => {
    // 旧端点 /tenants/:id/plan 已移除——返回 404 而非 200
    const res = await app.request(
      await authed('http://x/api/admin/tenants/tenant-a/plan', {
        method: 'PUT', body: JSON.stringify({ plan: 'pro' }),
      }),
    );
    expect(res.status).toBe(404);
  });
});
