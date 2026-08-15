/**
 * channels 路由测试（S10，#77）
 *
 * 契约（飞书可选通道绑定）：
 * - PUT /api/channels/feishu {webhook}：鉴权 + 租户校验；webhook 校验
 *   （https URL）；存 S4 secrets（feishu_webhook，信封加密落 DB）
 * - GET /api/channels：返回通道配置状态（已绑定名列表，不回显凭证）
 * - DELETE /api/channels/feishu：解绑（删 secret）
 * - 租户只由 session claim 决定
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant } from '../tenant.js';
import { signSession, SESSION_COOKIE } from '../session.js';
import { openTenantSecrets } from '../secrets/tenant-secrets.js';
import { loadMasterKey } from '../secrets/master-key.js';
import { createChannelsRoutes } from './channels.js';

const SECRET = 'x'.repeat(40);

describe('channels 路由（飞书可选通道绑定）', () => {
  let dataDir: string;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-channels-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    // master key（S4 约定：dataDir/master.key，0600）
    writeFileSync(join(dataDir, 'master.key'), 'ab'.repeat(32), { mode: 0o600 });
    await loadMasterKey(dataDir);
    app = new Hono();
    const config = { dataDir, sessionSecret: SECRET } as Parameters<
      typeof createChannelsRoutes
    >[0]['config'];
    app.route('/api/channels', createChannelsRoutes({ config }));
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
    headers.set('x-tenant-id', 'bob');
    return new Request(url, { ...init, headers });
  }

  it('PUT /api/channels/feishu：webhook 加密存储（S4 信封），可回读', async () => {
    const req = await authed('http://x/api/channels/feishu', {
      method: 'PUT',
      body: JSON.stringify({ webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/xyz' }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);

    const store = await openTenantSecrets(dataDir, 'alice');
    expect(await store.get('feishu_webhook')).toBe(
      'https://open.feishu.cn/open-apis/bot/v2/hook/xyz',
    );
  });

  it('GET /api/channels：返回绑定状态不回显凭证', async () => {
    const store = await openTenantSecrets(dataDir, 'alice');
    await store.set('feishu_webhook', 'https://open.feishu.cn/open-apis/bot/v2/hook/xyz');

    const req = await authed('http://x/api/channels');
    const res = await app.request(req);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data: { feishu: boolean; webPush: 'default' };
    };
    expect(json.data.feishu).toBe(true);
    expect(JSON.stringify(json)).not.toContain('hook/xyz');
  });

  it('DELETE /api/channels/feishu：解绑', async () => {
    const store = await openTenantSecrets(dataDir, 'alice');
    await store.set('feishu_webhook', 'https://open.feishu.cn/open-apis/bot/v2/hook/xyz');

    const req = await authed('http://x/api/channels/feishu', { method: 'DELETE' });
    expect((await app.request(req)).status).toBe(200);
    expect(await store.get('feishu_webhook')).toBeNull();
  });

  it('校验：非 https webhook → 400；未登录 401', async () => {
    const bad = await authed('http://x/api/channels/feishu', {
      method: 'PUT',
      body: JSON.stringify({ webhook: 'http://insecure.example/hook' }),
    });
    expect((await app.request(bad)).status).toBe(400);

    const unauth = await app.request('/api/channels/feishu', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ webhook: 'https://x.example/hook' }),
    });
    expect(unauth.status).toBe(401);
  });
});
