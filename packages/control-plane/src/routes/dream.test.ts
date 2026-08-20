/**
 * dream 路由测试（#93 梦境系统）
 *
 * 契约：
 * - GET /api/dream 列表（时间倒序，含 title/excerpt；只读 diary/dreams/）
 * - GET /api/dream/:date 单篇；不存在 404；非法日期 400
 * - 租户隔离（alice 看不到 bob 的梦境）
 * - 无梦境目录 → 200 空列表（合法空态）
 * - 梦境与日记互不干扰（各自目录）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant, tenantDataDir } from '../tenant.js';
import { signSession, SESSION_COOKIE } from '../session.js';
import { createDreamRoutes } from './dream.js';

const SECRET = 'x'.repeat(40);

describe('dream 路由（#93 梦境）', () => {
  let dataDir: string;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-dream-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    await getOrCreateTenant(dataDir, 'bob');
    app = new Hono();
    app.route('/api/dream', createDreamRoutes({ config: { dataDir, sessionSecret: SECRET } }));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function authed(
    url: string,
    init: RequestInit = {},
    claims = { sub: 'alice', tenantId: 'alice' },
  ): Promise<Response> {
    const session = await signSession(claims, SECRET);
    const req = new Request(`http://localhost${url}`, {
      ...init,
      headers: { ...init.headers, cookie: `${SESSION_COOKIE}=${session}` },
    });
    return app.request(req);
  }

  /** 种梦境目录（alice 的 diary/dreams/） */
  function seedDreams(files: Array<{ date: string; body: string }>): void {
    const dir = join(tenantDataDir(dataDir, 'alice'), 'diary', 'dreams');
    mkdirSync(dir, { recursive: true });
    for (const f of files) {
      writeFileSync(join(dir, `${f.date}.md`), f.body, 'utf-8');
    }
  }

  it('GET /api/dream：返回梦境列表（时间倒序，含 title/excerpt）', async () => {
    seedDreams([
      { date: '2026-08-19', body: '# 梦境 · 2026-08-19\n\n梦见自己在博物馆迷路。' },
      { date: '2026-08-20', body: '# 梦境 · 2026-08-20\n\n梦见自己变成了一束量子光。' },
    ]);
    const res = await authed('/api/dream');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ date: string; title: string; excerpt: string }> };
    expect(json.data.map((d) => d.date)).toEqual(['2026-08-20', '2026-08-19']);
    expect(json.data[0]!.title).toBe('梦境 · 2026-08-20');
    expect(json.data[0]!.excerpt).toContain('量子光');
  });

  it('GET /api/dream/:date：返回单篇梦境内容', async () => {
    seedDreams([{ date: '2026-08-20', body: '# 梦境 · 2026-08-20\n\n正文' }]);
    const res = await authed('/api/dream/2026-08-20');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { date: string; content: string } };
    expect(json.data.date).toBe('2026-08-20');
    expect(json.data.content).toContain('正文');
  });

  it('GET /api/dream/:date：不存在 → 404；非法日期 → 400', async () => {
    const missing = await authed('/api/dream/2026-01-01');
    expect(missing.status).toBe(404);
    const bad = await authed('/api/dream/not-a-date');
    expect(bad.status).toBe(400);
  });

  it('无梦境目录 → 200 空列表（合法空态）', async () => {
    const res = await authed('/api/dream');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown };
    expect(json.data).toEqual([]);
  });

  it('租户隔离：未登录 401；bob 看不到 alice 的梦境', async () => {
    seedDreams([{ date: '2026-08-20', body: '# alice 的梦' }]);
    const unauth = await app.request('http://localhost/api/dream');
    expect(unauth.status).toBe(401);

    const bob = await authed('/api/dream', {}, { sub: 'bob', tenantId: 'bob' });
    expect(bob.status).toBe(200);
    const json = (await bob.json()) as { data: unknown[] };
    expect(json.data).toEqual([]);
  });

  it('梦境与日记互不干扰：日记目录里的 md 不进入梦境列表', async () => {
    // 只有日记文件、无梦境目录
    const diaryDir = join(tenantDataDir(dataDir, 'alice'), 'diary');
    mkdirSync(diaryDir, { recursive: true });
    writeFileSync(join(diaryDir, '2026-08-20.md'), '# 日记 · 2026-08-20\n\n今天……', 'utf-8');
    const res = await authed('/api/dream');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown[] };
    expect(json.data).toEqual([]);
  });
});
