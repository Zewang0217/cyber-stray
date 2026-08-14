/**
 * 租户注册 + session JWT + 安全硬规矩（x-tenant-* 忽略）测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { getOrCreateTenant, tenantDataDir } from './tenant.js';
import { signSession, verifySession } from './session.js';
import { resolveTenantFromRequest } from './request-tenant.js';

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

describe('getOrCreateTenant（首登自动建租户）', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-tenant-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('首次调用创建租户目录 + 注册表，租户键 = sub', async () => {
    const { tenantId, created } = await getOrCreateTenant(dataDir, 'casdoor-user-42');
    expect(created).toBe(true);
    expect(tenantId).toBe('casdoor-user-42');
    expect(existsSync(tenantDataDir(dataDir, tenantId))).toBe(true);

    const registry = JSON.parse(
      await readFile(join(dataDir, 'tenants-registry.json'), 'utf-8'),
    );
    expect(registry.tenants['casdoor-user-42']).toMatchObject({
      tenantId: 'casdoor-user-42',
      sub: 'casdoor-user-42',
    });
  });

  it('重复调用幂等：不重复建，返回既有租户', async () => {
    await getOrCreateTenant(dataDir, 'u1');
    const second = await getOrCreateTenant(dataDir, 'u1');
    expect(second.created).toBe(false);
    expect(second.tenantId).toBe('u1');
  });

  it('不同用户各自独立租户', async () => {
    await getOrCreateTenant(dataDir, 'u1');
    const r2 = await getOrCreateTenant(dataDir, 'u2');
    expect(r2).toEqual({ tenantId: 'u2', created: true });
  });
});

describe('安全硬规矩：租户从 session JWT 解析', () => {
  /**
   * 验收标准：服务端从 JWT claim 解析租户，忽略客户端传入的 x-tenant-* header。
   * 这是控制面的租户解析唯一入口——任何路由取租户都必须走它，
   * 不能读 x-tenant-*（防止跨租户数据访问）。
   */
  it('resolveTenantFromRequest 只认 cookie session，无视 x-tenant-* header', async () => {
    // 带 x-tenant-id 伪造头的请求，但 cookie 里的 session 属于 user-1
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
  });

  it('无 session cookie → null（未登录）', async () => {
    const req = new Request('http://localhost:8787/api/auth/me', {
      headers: { 'x-tenant-id': 'evil-tenant' },
    });
    expect(await resolveTenantFromRequest(req, TEST_SECRET)).toBeNull();
  });
});
