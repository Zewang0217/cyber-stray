import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant, tenantDataDir } from '../tenant.js';
import { signSession, SESSION_COOKIE } from '../session.js';
import { createFootprintRoutes } from './footprint.js';

const SECRET = 'x'.repeat(40);

describe('footprint 路由（游荡足迹——每次 loop 每一步骤）', () => {
  let dataDir: string;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-fp-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    await getOrCreateTenant(dataDir, 'bob');
    app = new Hono();
    app.route('/api/footprint', createFootprintRoutes({ config: { dataDir, sessionSecret: SECRET } }));
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
    headers.set('x-tenant-id', 'bob'); // 越权尝试：必须被忽略
    return new Request(url, { ...init, headers });
  }

  function seedFootprints(): void {
    const dir = tenantDataDir(dataDir, 'alice');
    mkdirSync(dir, { recursive: true });
    const steps = [
      { timestamp: '2026-08-16T02:21:45.252Z', tool: 'search_web', thought: '搜索: quantum computing' },
      { timestamp: '2026-08-16T02:21:51.253Z', tool: 'browse_page', url: 'https://phys.org/x', thought: '浏览: 论文' },
      { timestamp: '2026-08-16T02:22:10.001Z', tool: 'speak', thought: '分享发现', spoke: true },
      { timestamp: '2026-08-16T02:22:15.500Z', tool: 'search_web', thought: '搜索: 黑洞星' },
    ];
    writeFileSync(join(dir, 'wander-history.json'), JSON.stringify(steps));
  }

  it('GET /api/footprint：返回全部游荡步骤（时间倒序或正序均可消费，含 spoke 标记）', async () => {
    seedFootprints();
    const res = await app.request(await authed('http://x/api/footprint'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(json.data).toHaveLength(4);
    const speak = json.data.find((s) => s.tool === 'speak');
    expect(speak?.spoke).toBe(true);
    // 时间正序（时间线消费）
    const times = json.data.map((s) => new Date(String(s.timestamp)).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!);
    }
  });

  it('GET 未登录 401；跨租户不泄漏（bob 看不到 alice 足迹）', async () => {
    seedFootprints();
    const res = await app.request(
      await authed('http://x/api/footprint', {}, { sub: 'bob', tenantId: 'bob' }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown[] };
    expect(json.data).toHaveLength(0);

    const anon = await app.request(new Request('http://x/api/footprint'));
    expect(anon.status).toBe(401);
  });

  it('无足迹文件 → 200 空数组（合法空态）', async () => {
    const res = await app.request(await authed('http://x/api/footprint'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown[] };
    expect(json.data).toHaveLength(0);
  });

  it('损坏文件 → 500（禁兜底，不静默吞）', async () => {
    const dir = tenantDataDir(dataDir, 'alice');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'wander-history.json'), 'not-json{{{');
    const res = await app.request(await authed('http://x/api/footprint'));
    expect(res.status).toBe(500);
  });
});
