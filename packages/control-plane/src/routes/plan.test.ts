import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant } from '../tenant.js';
import { signSession, SESSION_COOKIE } from '../session.js';
import { loadMasterKey } from '../secrets/master-key.js';
import { openTenantSecrets } from '../secrets/tenant-secrets.js';
import { pets, tenants } from '../db/schema.js';
import { createPlanRoutes } from './plan.js';

const SECRET = 'x'.repeat(40);

describe('plan 路由（S11 套餐管理）', () => {
  let dataDir: string;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-plan-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    // master key（S4 约定：dataDir/master.key，0600）
    writeFileSync(join(dataDir, 'master.key'), 'ab'.repeat(32), { mode: 0o600 });
    await loadMasterKey(dataDir);
    app = new Hono();
    const config = { dataDir, sessionSecret: SECRET } as Parameters<
      typeof createPlanRoutes
    >[0]['config'];
    app.route('/api/plan', createPlanRoutes({ config }));
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
    // x-tenant-* 一律忽略（安全硬规矩）
    headers.set('x-tenant-id', 'bob');
    return new Request(url, { ...init, headers });
  }

  async function seedPet(tenantId: string): Promise<void> {
    const db = await getDb(dataDir);
    await db
      .insert(pets)
      .values({
        id: `pet-${tenantId}`,
        tenantId,
        name: '小溜',
        boredom: 30,
        energy: 80,
      })
      .run();
  }

  it('GET /api/plan：返回当前套餐与限额（含推送窗口）；未领养 → 409', async () => {
    await seedPet('alice');
    const db = await getDb(dataDir);
    await db.update(tenants).set({ plan: 'pro' }).where(eq(tenants.id, 'alice')).run();

    const res = await app.request(await authed('http://x/api/plan'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data: { plan: string; limits: { pushesPerDay: number }; byok: { keyBound: boolean } };
    };
    expect(json.data.plan).toBe('pro');
    expect(json.data.limits.pushesPerDay).toBe(20);
    expect(json.data.byok.keyBound).toBe(false);

    const db2 = await getDb(dataDir);
    await db2.delete(pets).run();
    const noPet = await app.request(await authed('http://x/api/plan'));
    expect(noPet.status).toBe(409);
  });

  it('PUT /api/plan：切 free→pro 落库；未知 plan → 400', async () => {
    await seedPet('alice');

    const res = await app.request(
      await authed('http://x/api/plan', { method: 'PUT', body: JSON.stringify({ plan: 'pro' }) }),
    );
    expect(res.status).toBe(200);

    const db = await getDb(dataDir);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, 'alice')).get();
    const tenant = await db.select().from(tenants).where(eq(tenants.id, 'alice')).get();
    expect(tenant?.plan).toBe('pro');

    const bad = await app.request(
      await authed('http://x/api/plan', {
        method: 'PUT',
        body: JSON.stringify({ plan: 'enterprise' }),
      }),
    );
    expect(bad.status).toBe(400);
  });

  it('PUT 套餐降级时清推送窗口（free 用户无自定义窗口权限）', async () => {
    await seedPet('alice');
    const db = await getDb(dataDir);
    await db
      .update(pets)
      .set({ plan: 'pro', pushWindowStart: 9, pushWindowEnd: 22 })
      .where(eq(pets.tenantId, 'alice'))
      .run();

    const res = await app.request(
      await authed('http://x/api/plan', { method: 'PUT', body: JSON.stringify({ plan: 'free' }) }),
    );
    expect(res.status).toBe(200);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, 'alice')).get();
    const tenant = await db.select().from(tenants).where(eq(tenants.id, 'alice')).get();
    expect(tenant?.plan).toBe('free');
    expect(pet?.pushWindowStart).toBeNull();
    expect(pet?.pushWindowEnd).toBeNull();
  });

  it('PUT /api/plan/push-window：pro 设窗口（跨午夜合法）；free → 403；非法小时 → 400', async () => {
    await seedPet('alice');
    const db = await getDb(dataDir);
    await db.update(tenants).set({ plan: 'pro' }).where(eq(tenants.id, 'alice')).run();

    // 跨午夜（22 → 6）是 Pro 明确合法场景
    const res = await app.request(
      await authed('http://x/api/plan/push-window', {
        method: 'PUT',
        body: JSON.stringify({ startHour: 22, endHour: 6 }),
      }),
    );
    expect(res.status).toBe(200);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, 'alice')).get();
    expect(pet?.pushWindowStart).toBe(22);
    expect(pet?.pushWindowEnd).toBe(6);

    // start == end 拒绝（空窗口）
    const same = await app.request(
      await authed('http://x/api/plan/push-window', {
        method: 'PUT',
        body: JSON.stringify({ startHour: 9, endHour: 9 }),
      }),
    );
    expect(same.status).toBe(400);

    // 越界（24）
    const oob = await app.request(
      await authed('http://x/api/plan/push-window', {
        method: 'PUT',
        body: JSON.stringify({ startHour: 0, endHour: 24 }),
      }),
    );
    expect(oob.status).toBe(400);

    // free 无权
    await db.update(tenants).set({ plan: 'free' }).where(eq(tenants.id, 'alice')).run();
    const denied = await app.request(
      await authed('http://x/api/plan/push-window', {
        method: 'PUT',
        body: JSON.stringify({ startHour: 9, endHour: 22 }),
      }),
    );
    expect(denied.status).toBe(403);
  });

  it('DELETE /api/plan/push-window：清窗口（回全天）', async () => {
    await seedPet('alice');
    const db = await getDb(dataDir);
    await db
      .update(pets)
      .set({ plan: 'pro', pushWindowStart: 9, pushWindowEnd: 22 })
      .where(eq(pets.tenantId, 'alice'))
      .run();

    const res = await app.request(await authed('http://x/api/plan/push-window', { method: 'DELETE' }));
    expect(res.status).toBe(200);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, 'alice')).get();
    expect(pet?.pushWindowStart).toBeNull();
    expect(pet?.pushWindowEnd).toBeNull();
  });

  it('PUT /api/plan/byok-key：存 S4 加密 deepseek_api_key；非 byok 套餐 → 403', async () => {
    await seedPet('alice');
    const db = await getDb(dataDir);
    await db.update(tenants).set({ plan: 'byok' }).where(eq(tenants.id, 'alice')).run();

    const res = await app.request(
      await authed('http://x/api/plan/byok-key', {
        method: 'PUT',
        body: JSON.stringify({ apiKey: 'sk-byok-test-123' }),
      }),
    );
    expect(res.status).toBe(200);

    // 加密落 S4 secrets
    const store = await openTenantSecrets(dataDir, 'alice');
    expect(await store.get('deepseek_api_key')).toBe('sk-byok-test-123');

    // 非 byok 套餐拒绝
    await db.update(tenants).set({ plan: 'free' }).where(eq(tenants.id, 'alice')).run();
    const denied = await app.request(
      await authed('http://x/api/plan/byok-key', {
        method: 'PUT',
        body: JSON.stringify({ apiKey: 'sk-x' }),
      }),
    );
    expect(denied.status).toBe(403);
  });

  it('GET byok 状态：有 key 报 bound，不回显内容', async () => {
    await seedPet('alice');
    const db = await getDb(dataDir);
    await db.update(tenants).set({ plan: 'byok' }).where(eq(tenants.id, 'alice')).run();

    let res = await app.request(await authed('http://x/api/plan'));
    let json = (await res.json()) as { data: { byok: { keyBound: boolean } } };
    expect(json.data.byok.keyBound).toBe(false);

    await app.request(
      await authed('http://x/api/plan/byok-key', {
        method: 'PUT',
        body: JSON.stringify({ apiKey: 'sk-byok-1' }),
      }),
    );
    res = await app.request(await authed('http://x/api/plan'));
    json = (await res.json()) as { data: { byok: { keyBound: boolean } } };
    expect(json.data.byok.keyBound).toBe(true);
    // 全响应不含 key 明文
    const raw = JSON.stringify(json);
    expect(raw).not.toContain('sk-byok-1');
  });

  it('他租户 session → 403；未登录 → 401', async () => {
    const res = await app.request(
      await authed('http://x/api/plan', {}, { sub: 'mallory', tenantId: 'bob' }),
    );
    expect(res.status).toBe(403);

    const anon = await app.request(new Request('http://x/api/plan'));
    expect(anon.status).toBe(401);
  });
});
