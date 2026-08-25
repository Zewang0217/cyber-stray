/**
 * pet-assets 路由 API 契约测试（#95 IP 消费侧）
 *
 * 契约：
 * - 未登录：manifest + 素材文件全部 401
 * - 他人租户（无关系/非法 tenant id）：404（不泄露素材存在性）
 * - manifest：本租户有自定义素材 → 200 原样返回清单（含状态表）；无 → 404
 * - 素材文件：本租户文件 → 正确 content-type 服务；缺失 → 404
 * - 路径穿越（..）→ 400；文件名白名单拒绝非 png/json
 * - x-tenant-* header 一律忽略（session claim 才是租户真相）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant } from '../tenant.js';
import { signSession, SESSION_COOKIE } from '../session.js';
import { createApp, type AppDeps } from '../app.js';
import { createEventBus } from '../events/bus.js';
import { loadConfig } from '../config.js';
import { createPetAssetRoutes } from './pet-assets.js';

const SECRET = 'x'.repeat(40);

/** 样例 manifest（与 #94 finalize 写入形状对齐） */
const MANIFEST = {
  version: 1,
  generatedAt: '2026-08-20T00:00:00.000Z',
  spec: { specText: '戴红围巾的橘猫', stylePreset: 'chibi-kawaii' },
  concept: 'concept.png',
  states: {
    idle: { file: 'idle', frames: 1, dur: 1.6, label: '待机呼吸' },
    walk: { file: 'walk', frames: 1, dur: 0.8, label: '游荡' },
  },
};

describe('pet-assets 路由（#95）', () => {
  let dataDir: string;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-pet-assets-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    await getOrCreateTenant(dataDir, 'bob');
    app = new Hono();
    app.route(
      '/api',
      createPetAssetRoutes({
        config: { dataDir, sessionSecret: SECRET } as Parameters<
          typeof createPetAssetRoutes
        >[0]['config'],
      }),
    );
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
    headers.set('x-tenant-id', 'bob'); // 安全硬规矩：一律忽略
    return new Request(url, { ...init, headers });
  }

  /** 给租户写一套自定义素材（manifest + 状态 PNG） */
  function writeAssets(tenantId: string, overrides: { manifest?: unknown; pngs?: string[] } = {}) {
    const assetsDir = join(dataDir, 'tenants', tenantId, 'pet-assets');
    mkdirSync(assetsDir, { recursive: true });
    if (overrides.manifest !== null) {
      writeFileSync(join(assetsDir, 'manifest.json'), JSON.stringify(overrides.manifest ?? MANIFEST));
    }
    for (const name of overrides.pngs ?? ['idle.png', 'walk.png']) {
      writeFileSync(join(assetsDir, name), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }
  }

  it('未登录：manifest + 素材文件全部 401', async () => {
    expect((await app.request('/api/pet/manifest')).status).toBe(401);
    expect((await app.request('/api/pet-assets/idle.png')).status).toBe(401);
  });

  it('他人租户：bob 的素材 alice 访问不到（404，含 manifest）', async () => {
    writeAssets('bob');
    // alice 登录，但会话租户是 alice；bob 的素材对 alice 不可见（404）
    const manifest = await app.request(await authed('http://x/api/pet/manifest'));
    expect(manifest.status).toBe(404);
    const file = await app.request(await authed('http://x/api/pet-assets/idle.png'));
    expect(file.status).toBe(404);
  });

  it('非法租户 claim（无关系行）：404', async () => {
    const req = await authed('http://x/api/pet/manifest', {}, { sub: 'alice', tenantId: 'mallory' });
    expect((await app.request(req)).status).toBe(404);
  });

  it('manifest：本租户有自定义素材 → 200 原样返回清单（含状态表）', async () => {
    writeAssets('alice');
    const res = await app.request(await authed('http://x/api/pet/manifest'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as typeof MANIFEST;
    expect(body.version).toBe(1);
    expect(body.states.idle).toEqual({ file: 'idle', frames: 1, dur: 1.6, label: '待机呼吸' });
    expect(body.states.walk.frames).toBe(1);
  });

  it('manifest：无自定义素材 → 404（web 回退内置）', async () => {
    const res = await app.request(await authed('http://x/api/pet/manifest'));
    expect(res.status).toBe(404);
  });

  it('素材文件：本租户 PNG 正确 content-type 服务；缺失 404', async () => {
    writeAssets('alice');
    const png = await app.request(await authed('http://x/api/pet-assets/idle.png'));
    expect(png.status).toBe(200);
    expect(png.headers.get('content-type')).toBe('image/png');
    const missing = await app.request(await authed('http://x/api/pet-assets/celebrate.png'));
    expect(missing.status).toBe(404);
  });

  it('路径穿越：.. 归一化到目录外 → 400；子路径不路由 → 404', async () => {
    writeAssets('alice');
    const evil = await app.request(await authed('http://x/api/pet-assets/..%2F..%2Fmaster.key'));
    expect(evil.status).toBe(400);
    // 白名单只允许顶层 flat 文件：多段子路径不匹配 :file 路由 → 404（不服务）
    const subdir = await app.request(await authed('http://x/api/pet-assets/tasks/x/idle.png'));
    expect(subdir.status).toBe(404);
  });
});

describe('pet-assets 经 createApp 全链路挂载（app.ts 装配）', () => {
  let dataDir: string;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-pet-assets-app-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    const deps: AppDeps = {
      config: loadConfig({
        CP_SESSION_SECRET: SECRET,
        CP_DATA_DIR: dataDir,
        CP_WEB_ORIGIN: 'http://localhost:3000',
      } as NodeJS.ProcessEnv),
      oidc: {
        buildAuthUrl: async () => ({ url: 'http://x', state: 's', nonce: 'n', verifier: 'v' }),
        handleCallback: async () => ({ sub: 'alice', email: 'a@b.c' }),
      },
      bus: createEventBus(),
    };
    app = createApp(deps);
  });

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('全链路：未登录 401；登录后本租户 manifest 200 + 素材 PNG 服务', async () => {
    expect((await app.request('/api/pet/manifest')).status).toBe(401);

    const assetsDir = join(dataDir, 'tenants', 'alice', 'pet-assets');
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(join(assetsDir, 'manifest.json'), JSON.stringify(MANIFEST));
    writeFileSync(join(assetsDir, 'idle.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const token = await signSession({ sub: 'alice', tenantId: 'alice' }, SECRET);
    const headers = { cookie: `${SESSION_COOKIE}=${token}` };

    const manifest = await app.request('/api/pet/manifest', { headers });
    expect(manifest.status).toBe(200);
    expect(((await manifest.json()) as typeof MANIFEST).states.idle.frames).toBe(1);

    const png = await app.request('/api/pet-assets/idle.png', { headers });
    expect(png.status).toBe(200);
    expect(png.headers.get('content-type')).toBe('image/png');
  });
});
