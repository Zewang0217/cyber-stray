/**
 * 租户注册 + session JWT + 安全硬规矩（x-tenant-* 忽略）测试
 *
 * S3：租户注册走控制面 SQLite（tenants + user_tenants），数据目录保留。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import { eq } from 'drizzle-orm';
import { getOrCreateTenant, tenantDataDir } from './tenant.js';
import { signSession, verifySession } from './session.js';
import { resolveTenantFromRequest } from './request-tenant.js';
import { getDb, _resetDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { tenants, userTenants } from './db/schema.js';

const TEST_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

describe('session JWT', () => {
  it('签发 → 验证往返得到 sub + tenantId', async () => {
    const token = await signSession({ sub: 'user-1', tenantId: 'user-1' }, TEST_SECRET);
    const claims = await verifySession(token, TEST_SECRET);
    expect(claims).toEqual({ sub: 'user-1', tenantId: 'user-1' });
  });

  it('错误 secret 验证失败返回 null', async () => {
    const token = await signSession({ sub: 'u', tenantId: 'u' }, TEST_SECRET);
    expect(await verifySession(token, 'wrong-secret-0123456789abcdef0123456789abc')).toBeNull();
  });

  it('篡改 token 返回 null', async () => {
    const token = await signSession({ sub: 'u', tenantId: 'u' }, TEST_SECRET);
    const tampered = token.slice(0, -2) + (token.endsWith('ab') ? 'cd' : 'ab');
    expect(await verifySession(tampered, TEST_SECRET)).toBeNull();
  });

  it('过期 token 返回 null', async () => {
    const token = await signSession({ sub: 'u', tenantId: 'u' }, TEST_SECRET, -1);
    expect(await verifySession(token, TEST_SECRET)).toBeNull();
  });
});

describe('getOrCreateTenant（首登自动建租户，S3 DB 版）', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-tenant-'));
    _resetDb();
    await runMigrations(dataDir);
  });

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('首次调用建租户行 + 用户关系 + 数据目录，租户键 = sub', async () => {
    const { tenantId, created } = await getOrCreateTenant(dataDir, 'casdoor-user-42', '小王');
    expect(created).toBe(true);
    expect(tenantId).toBe('casdoor-user-42');
    expect(existsSync(tenantDataDir(dataDir, tenantId))).toBe(true);

    const db = await getDb(dataDir);
    const t = await db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
    expect(t?.name).toBe('小王');

    const rel = await db
      .select()
      .from(userTenants)
      .where(eq(userTenants.userId, 'casdoor-user-42'))
      .get();
    expect(rel?.tenantId).toBe('casdoor-user-42');
    expect(rel?.role).toBe('owner');
  });

  it('重复调用幂等：不重复建，返回既有租户', async () => {
    await getOrCreateTenant(dataDir, 'u1');
    const second = await getOrCreateTenant(dataDir, 'u1');
    expect(second.created).toBe(false);
    expect(second.tenantId).toBe('u1');

    const db = await getDb(dataDir);
    expect((await db.select().from(tenants).all()).length).toBe(1);
  });

  it('不同用户各自独立租户', async () => {
    await getOrCreateTenant(dataDir, 'u1');
    const r2 = await getOrCreateTenant(dataDir, 'u2');
    expect(r2).toEqual({ tenantId: 'u2', created: true });

    const db = await getDb(dataDir);
    expect((await db.select().from(tenants).all()).length).toBe(2);
  });

  it('并发首登同 sub：只有一个 created:true，无 500 无孤儿', async () => {
    const results = await Promise.all([
      getOrCreateTenant(dataDir, 'race-user'),
      getOrCreateTenant(dataDir, 'race-user'),
    ]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(results.map((r) => r.tenantId)).toEqual(['race-user', 'race-user']);

    const db = await getDb(dataDir);
    expect((await db.select().from(tenants).all()).length).toBe(1);
    expect((await db.select().from(userTenants).all()).length).toBe(1);
  });
});

describe('安全硬规矩：租户从 session JWT 解析', () => {
  it('resolveTenantFromRequest 只认 cookie session，无视 x-tenant-* header', async () => {
    const token = await signSession({ sub: 'user-1', tenantId: 'user-1' }, TEST_SECRET);
    const req = new Request('http://localhost:8787/api/auth/me', {
      headers: {
        cookie: `cs_session=${token}`,
        'x-tenant-id': 'evil-tenant',
        'x-tenant-slug': 'evil',
      },
    });

    const session = await resolveTenantFromRequest(req, TEST_SECRET);
    expect(session?.tenantId).toBe('user-1');
    expect(session?.sub).toBe('user-1');
  });

  it('无 session cookie → null（未登录）', async () => {
    const req = new Request('http://localhost:8787/api/auth/me', {
      headers: { 'x-tenant-id': 'evil-tenant' },
    });
    expect(await resolveTenantFromRequest(req, TEST_SECRET)).toBeNull();
  });

  it('畸形 Cookie 编码不抛 500（返回 null 视为未登录）', async () => {
    const req = new Request('http://localhost:8787/api/auth/me', {
      headers: { cookie: 'x=%' },
    });
    expect(await resolveTenantFromRequest(req, TEST_SECRET)).toBeNull();
  });
});
