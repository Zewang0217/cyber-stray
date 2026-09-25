/**
 * requireTenant 活跃埋点测试（#302）——鉴权通过 = 落一行活跃；未登录/无关系不落。
 *
 * 契约：埋点是 fire-and-forget（no-throw），失败不影响业务请求。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { tenants, userTenants } from '../db/schema.js';
import { signSession, SESSION_COOKIE } from './session.js';
import { requireTenant, type TenantEnv } from './require-tenant.js';
import { readTenantActivityDays } from '../infra/tenant-activity.js';
import { localDateKey } from '../infra/usage.js';

const SECRET = 'x'.repeat(40);
let dataDir: string;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'cp-req-tenant-'));
  await runMigrations(dataDir);
  const db = await getDb(dataDir);
  await db.insert(tenants).values({ id: 'tenant-a', name: '租户A' });
  await db.insert(userTenants).values({ userId: 'sub-a', tenantId: 'tenant-a' });
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  _resetDb();
});

function makeApp(): Hono<TenantEnv> {
  const app = new Hono<TenantEnv>();
  app.use('/api/*', requireTenant({ dataDir, sessionSecret: SECRET }));
  app.get('/api/pets', (c) => c.json({ ok: true }));
  return app;
}

describe('requireTenant 活跃埋点（#302）', () => {
  it('鉴权通过：200 + 活跃 JSONL 落一行（当日）', async () => {
    const token = await signSession({ sub: 'sub-a', tenantId: 'tenant-a' }, SECRET);
    const res = await makeApp().request('/api/pets', {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status).toBe(200);

    // 埋点 fire-and-forget：轮询等待落盘完成
    await vi.waitFor(async () => {
      const days = await readTenantActivityDays(join(dataDir, 'tenants', 'tenant-a'));
      expect(days).toEqual([localDateKey()]);
    });
  });

  it('未登录：401 且不落活跃', async () => {
    const res = await makeApp().request('/api/pets');
    expect(res.status).toBe(401);
    // 留出 fire-and-forget 的理论落盘窗口，确认确实没写
    await new Promise((r) => setTimeout(r, 20));
    await expect(
      readTenantActivityDays(join(dataDir, 'tenants', 'tenant-a')),
    ).resolves.toEqual([]);
  });

  it('session 声明了无关系的租户：403 且不落活跃', async () => {
    const token = await signSession({ sub: 'sub-x', tenantId: 'tenant-x' }, SECRET);
    const res = await makeApp().request('/api/pets', {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status).toBe(403);
    await new Promise((r) => setTimeout(r, 20));
    await expect(
      readTenantActivityDays(join(dataDir, 'tenants', 'tenant-x')),
    ).resolves.toEqual([]);
  });
});
