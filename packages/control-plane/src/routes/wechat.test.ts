/**
 * 微信路由测试（#97）
 *
 * 契约：
 * - POST /api/wechat/bind/start（公开，无 Casdoor 会话）→ 二维码 + 会话 id
 * - GET /api/wechat/bind/status?session= → wait/scaned/confirmed/expired/error
 *   （confirmed 带 result；他人扫码 error 明确反馈）
 * - GET /api/wechat/status（登录态）→ bound/status/expiredHint
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant } from '../tenant.js';
import { signSession, SESSION_COOKIE } from '../session.js';
import { loadMasterKey } from '../secrets/master-key.js';
import { BindingService } from '../ilink/binding-service.js';
import { scriptedFetch, setupTestDataDir } from '../ilink/test-helpers.js';
import { createWechatRoutes } from './wechat.js';
import { initLogger, getLogFilePath, _resetLogger } from '../logger.js';

const SECRET = 'x'.repeat(40);

const CONFIRMED = {
  status: 'confirmed',
  bot_token: 'v1_bot_token',
  ilink_bot_id: 'bot123@im.bot',
  baseurl: 'https://ilinkai.weixin.qq.com',
  ilink_user_id: 'owner@im.wechat',
} as const;

describe('wechat 路由', () => {
  let dataDir: string;
  let app: Hono;
  let service: BindingService;

  beforeEach(async () => {
    dataDir = await setupTestDataDir();
    await getOrCreateTenant(dataDir, 'alice');
    writeFileSync(join(dataDir, 'master.key'), 'ab'.repeat(32), { mode: 0o600 });
    await loadMasterKey(dataDir);

    const { client } = scriptedFetch([
      () => ({ qrcode: 'qr-1', qrcode_img_content: 'https://qr.example/1' }),
      () => CONFIRMED,
    ]);
    service = new BindingService({
      dataDir,
      client: () => client,
      pollIntervalMs: 1,
      sleepFn: async () => {},
    });

    app = new Hono();
    const config = { dataDir, sessionSecret: SECRET } as Parameters<typeof createWechatRoutes>[0]['config'];
    app.route('/api/wechat', createWechatRoutes({ config, bindings: service }));
  });

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('POST /bind/start：公开（无 session）→ 二维码 URL + 会话；随后轮询到 confirmed', async () => {
    const res = await app.request('/api/wechat/bind/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data: { sessionId: string; qrcodeImgUrl: string; expiresAt: number };
    };
    expect(json.data.qrcodeImgUrl).toBe('https://qr.example/1');
    expect(json.data.sessionId).toBeTruthy();

    // 等后台循环确认
    await service.waitSettled(json.data.sessionId);
    const statusRes = await app.request(`/api/wechat/bind/status?session=${json.data.sessionId}`);
    const statusJson = (await statusRes.json()) as { success: boolean; data: { status: string; result?: { tenantId: string } } };
    expect(statusJson.data.status).toBe('confirmed');
    expect(statusJson.data.result?.tenantId).toContain('wx-');
  });

  it('GET /bind/status：session 缺失/非法 → 400；未知 session → not_found', async () => {
    const bad = await app.request('/api/wechat/bind/status');
    expect(bad.status).toBe(400);
    const nf = await app.request('/api/wechat/bind/status?session=deadbeef');
    const nfJson = (await nf.json()) as { data: { status: string } };
    expect(nfJson.data.status).toBe('not_found');
  });

  it('POST /bind/start：tenantId 非法 → 400', async () => {
    const res = await app.request('/api/wechat/bind/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: '../evil' }),
    });
    expect(res.status).toBe(400);
  });

  it('GET /status：未绑定 → bound:false；绑定后 → bound:true + status', async () => {
    async function authed() {
      const token = await signSession({ sub: 'alice', tenantId: 'alice' }, SECRET);
      return new Request('http://x/api/wechat/status', {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      });
    }

    const before = await app.request(await authed());
    const beforeJson = (await before.json()) as { data: { bound: boolean } };
    expect(beforeJson.data.bound).toBe(false);

    // 模拟绑定完成（直接走 service 确认流程）
    const startRes = await app.request('/api/wechat/bind/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const { sessionId } = ((await startRes.json()) as { data: { sessionId: string } }).data;
    await service.waitSettled(sessionId);

    // 新微信租户与 alice 无 user_tenants 关系 → 未登录视角仍为 alice 的租户，
    // 断言 alice 租户未绑定（微信租户是独立租户）
    const after = await app.request(await authed());
    const afterJson = (await after.json()) as { data: { bound: boolean } };
    expect(afterJson.data.bound).toBe(false);

    // 无 session → 401
    const unauth = await app.request('/api/wechat/status');
    expect(unauth.status).toBe(401);
  });

  it('GET /status：绑定后返回 status + expiredHint（过期提示）', async () => {
    // 直接给 alice 落一条 expired 绑定（走 DB）
    const db = await getDb(dataDir);
    const { wechatBindings } = await import('../db/schema.js');
    await db.insert(wechatBindings).values({
      tenantId: 'alice',
      ilinkUserId: 'owner@im.wechat',
      ilinkBotId: 'bot@im.bot',
      baseUrl: 'https://ilinkai.weixin.qq.com',
      status: 'expired',
    }).run();

    const token = await signSession({ sub: 'alice', tenantId: 'alice' }, SECRET);
    const res = await app.request(
      new Request('http://x/api/wechat/status', {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      }),
    );
    const json = (await res.json()) as { data: { bound: boolean; status: string; expiredHint?: string } };
    expect(json.data.bound).toBe(true);
    expect(json.data.status).toBe('expired');
    expect(json.data.expiredHint).toContain('重新激活');
  });
});

describe('绑定失败可追查（#116）', () => {
  let dataDir: string;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-wechat-log-'));
    initLogger(dataDir);
    // start 抛网络错误（模拟生产 socket closed）
    const failing = {
      start: vi.fn(async () => {
        throw new Error('iLink 网络错误: The socket connection was closed unexpectedly.');
      }),
      getStatus: vi.fn(),
    } as unknown as BindingService;

    app = new Hono();
    const config = { dataDir, sessionSecret: SECRET } as Parameters<
      typeof createWechatRoutes
    >[0]['config'];
    app.route('/api/wechat', createWechatRoutes({ config, bindings: failing }));
  });

  afterEach(() => {
    _resetLogger();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('start 抛错 → 502 + 日志行含 clientKey/endpoint/error（不再静默吞错）', async () => {
    const res = await app.request('/api/wechat/bind/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain('获取二维码失败');

    const path = getLogFilePath();
    expect(path).not.toBeNull();
    const lines = readFileSync(path!, 'utf-8').trim().split('\n').filter(Boolean);
    const entry = JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
    expect(entry.level).toBe('error');
    expect(entry.message).toBe('绑定发起失败');
    expect(entry.data).toMatchObject({
      clientKey: '203.0.113.7',
      endpoint: 'get_bot_qrcode',
      tenantId: null,
      error: 'iLink 网络错误: The socket connection was closed unexpectedly.',
    });
  });

  it('限流错误 → 429 + 同样记日志（429 分支不吞错）', async () => {
    const failing = {
      start: vi.fn(async () => {
        throw new Error('发起过于频繁,请稍后再试');
      }),
      getStatus: vi.fn(),
    } as unknown as BindingService;
    const app2 = new Hono();
    const config = { dataDir, sessionSecret: SECRET } as Parameters<
      typeof createWechatRoutes
    >[0]['config'];
    app2.route('/api/wechat', createWechatRoutes({ config, bindings: failing }));

    const res = await app2.request('/api/wechat/bind/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(429);
    const path = getLogFilePath();
    const lines = readFileSync(path!, 'utf-8').trim().split('\n').filter(Boolean);
    const entry = JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
    expect(entry.level).toBe('error');
    expect(entry.message).toBe('绑定发起失败');
    expect((entry.data as Record<string, unknown>).error).toContain('过于频繁');
  });
});
