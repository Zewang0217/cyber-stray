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
import { pets, userTenants } from '../db/schema.js';
import { createAdminRoutes } from './admin.js';

const SECRET = 'x'.repeat(40);

describe('admin 路由（运营管理面板）', () => {
  let dataDir: string;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-admin-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'tenant-a');
    await getOrCreateTenant(dataDir, 'tenant-b');
    const db = await getDb(dataDir);
    await db
      .insert(pets)
      .values({
        id: 'pet-a1',
        tenantId: 'tenant-a',
        name: '小溜',
        status: 'active',
        boredom: 30,
        energy: 80,
      })
      .run();
    await db
      .insert(pets)
      .values({
        id: 'pet-b1',
        tenantId: 'tenant-b',
        name: '阿黄',
        status: 'paused',
        plan: 'pro',
        boredom: 55,
        energy: 40,
      })
      .run();
    // 两个租户各写一个 state.json 统计
    const stateA = join(tenantDataDir(dataDir, 'tenant-a'), 'state.json');
    mkdirSync(join(tenantDataDir(dataDir, 'tenant-a')), { recursive: true });
    writeFileSync(stateA, JSON.stringify({ totalWanders: 11, totalPushes: 19, boredom: 30, energy: 80 }));
    const stateB = join(tenantDataDir(dataDir, 'tenant-b'), 'state.json');
    mkdirSync(join(tenantDataDir(dataDir, 'tenant-b')), { recursive: true });
    writeFileSync(stateB, JSON.stringify({ totalWanders: 3, totalPushes: 7, boredom: 55, energy: 40 }));

    app = new Hono();
    const config = {
      dataDir,
      sessionSecret: SECRET,
      adminSubs: ['admin-1'],
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

  it('GET /api/admin/tenants：管理员可看全部租户宠物总览（含 state 统计）', async () => {
    const res = await app.request(await authed('http://x/api/admin/tenants'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(json.data).toHaveLength(2);
    const a = json.data.find((t) => t.tenantId === 'tenant-a');
    expect(a?.petName).toBe('小溜');
    expect(a?.plan).toBe('free');
    expect(a?.status).toBe('active');
    expect(a?.totalWanders).toBe(11);
    expect(a?.totalPushes).toBe(19);
  });

  it('非管理员 → 403；未登录 → 401', async () => {
    const res = await app.request(
      await authed('http://x/api/admin/tenants', {}, { sub: 'evil-user', tenantId: 'tenant-b' }),
    );
    expect(res.status).toBe(403);

    const anon = await app.request(new Request('http://x/api/admin/tenants'));
    expect(anon.status).toBe(401);
  });

  it('PUT /api/admin/tenants/:id/plan：管理员改套餐（额度分配）', async () => {
    const res = await app.request(
      await authed('http://x/api/admin/tenants/tenant-a/plan', {
        method: 'PUT',
        body: JSON.stringify({ plan: 'pro' }),
      }),
    );
    expect(res.status).toBe(200);

    const db = await getDb(dataDir);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, 'tenant-a')).get();
    expect(pet?.plan).toBe('pro');
  });

  it('PUT plan：非法 plan → 400；非管理员改他人 → 403', async () => {
    const bad = await app.request(
      await authed('http://x/api/admin/tenants/tenant-a/plan', {
        method: 'PUT',
        body: JSON.stringify({ plan: 'enterprise' }),
      }),
    );
    expect(bad.status).toBe(400);

    const denied = await app.request(
      await authed(
        'http://x/api/admin/tenants/tenant-a/plan',
        { method: 'PUT', body: JSON.stringify({ plan: 'pro' }) },
        { sub: 'not-admin', tenantId: 'tenant-b' },
      ),
    );
    expect(denied.status).toBe(403);
  });

  it('PUT /api/admin/tenants/:id/status：暂停/恢复宠物', async () => {
    const res = await app.request(
      await authed('http://x/api/admin/tenants/tenant-a/status', {
        method: 'PUT',
        body: JSON.stringify({ status: 'paused' }),
      }),
    );
    expect(res.status).toBe(200);
    const db = await getDb(dataDir);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, 'tenant-a')).get();
    expect(pet?.status).toBe('paused');
  });
});
