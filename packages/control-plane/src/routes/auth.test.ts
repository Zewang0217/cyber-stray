/**
 * 认证路由端到端测试（mock OIDC provider，驱动完整登录流）
 *
 * 覆盖：登录跳转、首登建租户、session cookie、/me 保护、登出清理、
 * x-tenant-* header 伪造无效（安全硬规矩）。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { createApp, type AppDeps } from '../app.js';
import { createEventBus } from '../events/bus.js';
import { loadConfig } from '../config.js';
import type { OidcProvider, OidcUser } from '../oidc.js';
import { tenantDataDir } from '../tenant.js';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { tenants } from '../db/schema.js';

const SECRET = 'test-session-secret-0123456789abcdef0123456789abcdef';

function makeConfig(dataDir: string) {
  return loadConfig({
    CP_SESSION_SECRET: SECRET,
    CP_DATA_DIR: dataDir,
    CP_WEB_ORIGIN: 'http://localhost:3000',
    CASDOOR_ISSUER: 'http://localhost:8000',
    CASDOOR_CLIENT_ID: 'test-client',
    CASDOOR_CLIENT_SECRET: 'test-secret',
    CASDOOR_REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
  } as NodeJS.ProcessEnv);
}

/** mock OIDC：authorize 跳转 + 回调返回固定用户 */
function makeMockOidc(user: OidcUser = { sub: 'casdoor-user-42', email: 'a@b.c' }): OidcProvider {
  return {
    buildAuthUrl: vi.fn(async () => {
      const state = 'mock-state-' + Math.random().toString(36).slice(2, 10);
      return {
        url: `http://casdoor.local/login?state=${state}`,
        state,
        nonce: 'mock-nonce',
        verifier: 'mock-verifier',
      };
    }),
    handleCallback: vi.fn(async (url: string, state: string) => {
      if (!url.includes(`state=${state}`)) throw new Error('state mismatch');
      return user;
    }),
  };
}

/** 从 /api/auth/login 的 302 Location 提取 state（模拟浏览器跟随） */
function extractState(location: string): string {
  const m = location.match(/[?&]state=([^&]+)/);
  if (!m?.[1]) throw new Error(`无法从 location 提取 state: ${location}`);
  return m[1];
}

describe('auth 路由', () => {
  let dataDir: string;
  let oidc: OidcProvider;
  let deps: AppDeps;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-app-'));
    oidc = makeMockOidc();
    deps = { config: makeConfig(dataDir), oidc, bus: createEventBus() };
    app = createApp(deps);
    _resetDb();
    await runMigrations(dataDir);
  });

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('GET /api/auth/login → 302 跳转 Casdoor 授权页', async () => {
    const res = await app.request('/api/auth/login');
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toMatch(/^http:\/\/casdoor\.local\/login\?state=/);
  });

  it('完整登录流：callback 首登建租户 + 设 session cookie + 跳 web', async () => {
    // 1. 登录拿 state
    const loginRes = await app.request('/api/auth/login');
    const state = extractState(loginRes.headers.get('location')!);

    // 2. 浏览器带 code+state 回回调
    const callbackRes = await app.request(`/api/auth/callback?code=mock-code&state=${state}`);
    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.get('location')).toBe('http://localhost:3000');

    // 3. session cookie 已设置
    const setCookie = callbackRes.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/cs_session=[^;]+/);
    expect(setCookie).toMatch(/HttpOnly/i);

    // 4. 租户已创建（DB 行 + 数据目录）
    expect(existsSync(tenantDataDir(dataDir, 'casdoor-user-42'))).toBe(true);
    const db = await getDb(dataDir);
    const tenant = await db.select().from(tenants).where(eq(tenants.id, 'casdoor-user-42')).get();
    expect(tenant?.id).toBe('casdoor-user-42');

    // 5. /me 带 cookie → 200
    const cookie = setCookie.split(';')[0]!;
    const meRes = await app.request('/api/auth/me', {
      headers: { cookie },
    });
    expect(meRes.status).toBe(200);
    expect(await meRes.json()).toEqual({ sub: 'casdoor-user-42', tenantId: 'casdoor-user-42' });
  });

  it('/me 未登录 → 401', async () => {
    const res = await app.request('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('/me 伪造 x-tenant-* header 不能提权', async () => {
    // 伪造 header 的未登录请求 → 仍然 401
    const res = await app.request('/api/auth/me', {
      headers: { 'x-tenant-id': 'evil-tenant' },
    });
    expect(res.status).toBe(401);
  });

  it('callback state 无效/已消费 → 401（防 CSRF 重放）', async () => {
    const res = await app.request('/api/auth/callback?code=x&state=forged-state');
    expect(res.status).toBe(401);

    // 合法 state 只能消费一次
    const loginRes = await app.request('/api/auth/login');
    const state = extractState(loginRes.headers.get('location')!);
    await app.request(`/api/auth/callback?code=mock-code&state=${state}`);
    const replay = await app.request(`/api/auth/callback?code=mock-code&state=${state}`);
    expect(replay.status).toBe(401);
  });

  it('POST /api/auth/logout → 清 cookie + 跳 web', async () => {
    const res = await app.request('/api/auth/logout', { method: 'POST' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost:3000');
    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/Max-Age=0/);
  });

  it('callback 幂等：同用户二次登录不重复建租户', async () => {
    const loginRes = await app.request('/api/auth/login');
    const state1 = extractState(loginRes.headers.get('location')!);
    await app.request(`/api/auth/callback?code=c1&state=${state1}`);

    const loginRes2 = await app.request('/api/auth/login');
    const state2 = extractState(loginRes2.headers.get('location')!);
    const res2 = await app.request(`/api/auth/callback?code=c2&state=${state2}`);
    expect(res2.status).toBe(302);

    // 二次登录后租户表仍只有一条
    const db = await getDb(dataDir);
    expect((await db.select().from(tenants).all()).length).toBe(1);
  });
});
