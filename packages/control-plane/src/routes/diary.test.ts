/**
 * diary 路由测试（#92 日记系统）
 *
 * 契约：
 * - GET /api/diary 列表（时间倒序，含 title/excerpt）
 * - GET /api/diary/:date 单篇；不存在 404；非法日期 400
 * - 租户隔离（alice 看不到 bob 的日记）
 * - 无日记目录 → 200 空列表（合法空态）
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
import { createDiaryRoutes } from './diary.js';

const SECRET = 'x'.repeat(40);

describe('diary 路由（#92 日记）', () => {
  let dataDir: string;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-diary-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    await getOrCreateTenant(dataDir, 'bob');
    app = new Hono();
    app.route('/api/diary', createDiaryRoutes({ config: { dataDir, sessionSecret: SECRET } }));
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

  /** 种日记目录（alice 的 diary/） */
  function seedDiary(files: Array<{ date: string; body: string }>): void {
    const dir = join(tenantDataDir(dataDir, 'alice'), 'diary');
    mkdirSync(dir, { recursive: true });
    for (const f of files) {
      writeFileSync(join(dir, `${f.date}.md`), f.body, 'utf-8');
    }
  }

  it('GET /api/diary：返回日记列表（时间倒序，含 title/excerpt）', async () => {
    seedDiary([
      { date: '2026-08-19', body: '# 日记 · 2026-08-19\n\n昨天去逛了博物馆。' },
      { date: '2026-08-20', body: '# 日记 · 2026-08-20\n\n今天发现了量子计算，好神奇！' },
    ]);
    const res = await authed('/api/diary');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ date: string; title: string; excerpt: string }> };
    expect(json.data.map((d) => d.date)).toEqual(['2026-08-20', '2026-08-19']);
    expect(json.data[0]!.title).toBe('日记 · 2026-08-20');
    expect(json.data[0]!.excerpt).toContain('量子计算');
  });

  it('GET /api/diary/:date：返回单篇内容', async () => {
    seedDiary([{ date: '2026-08-20', body: '# 日记 · 2026-08-20\n\n正文' }]);
    const res = await authed('/api/diary/2026-08-20');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { date: string; content: string } };
    expect(json.data.date).toBe('2026-08-20');
    expect(json.data.content).toContain('正文');
  });

  it('GET /api/diary/:date：不存在 → 404；非法日期 → 400', async () => {
    const missing = await authed('/api/diary/2026-01-01');
    expect(missing.status).toBe(404);
    const bad = await authed('/api/diary/not-a-date');
    expect(bad.status).toBe(400);
  });

  it('无日记目录 → 200 空列表（合法空态）', async () => {
    const res = await authed('/api/diary');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown };
    expect(json.data).toEqual([]);
  });

  it('租户隔离：未登录 401；bob 看不到 alice 的日记', async () => {
    seedDiary([{ date: '2026-08-20', body: '# alice 的日记' }]);
    const unauth = await app.request('http://localhost/api/diary');
    expect(unauth.status).toBe(401);

    const bob = await authed('/api/diary', {}, { sub: 'bob', tenantId: 'bob' });
    expect(bob.status).toBe(200);
    const json = (await bob.json()) as { data: unknown[] };
    expect(json.data).toEqual([]);
  });
});
