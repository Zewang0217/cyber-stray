import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmDataDir } from '../test/rm-data-dir.js';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant, tenantDataDir } from '../infra/tenant.js';
import { signSession, SESSION_COOKIE } from '../auth/session.js';
import { createTrailRoutes } from './trail.js';

const SECRET = 'x'.repeat(40);

describe('trail 路由（关系图谱数据源：记忆索引 + 叼回记录）', () => {
  let dataDir: string;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-trail-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    await getOrCreateTenant(dataDir, 'bob');
    app = new Hono();
    app.route('/api/trail', createTrailRoutes({ config: { dataDir, sessionSecret: SECRET } }));
  });

  afterEach(async () => {
    _resetDb();
    await rmDataDir(dataDir);
  });

  async function authed(
    url: string,
    claims = { sub: 'alice', tenantId: 'alice' },
  ): Promise<Request> {
    const token = await signSession(claims, SECRET);
    const headers = new Headers();
    headers.set('cookie', `${SESSION_COOKIE}=${token}`);
    headers.set('x-tenant-id', 'bob'); // 越权尝试：必须被忽略
    return new Request(url, { headers });
  }

  function seedMemoryIndex(tenant: string, records: unknown[]): void {
    const dir = join(tenantDataDir(dataDir, tenant), 'memory');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.index.json'), JSON.stringify({ version: 1, lastUpdated: '2026-10-08T00:00:00.000Z', records }));
  }

  function seedSpeaks(tenant: string, lines: unknown[]): void {
    const dir = join(tenantDataDir(dataDir, tenant), 'history');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'speaks-2026-10-08.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  }

  it('GET /api/trail/memory：返回记忆索引 records', async () => {
    seedMemoryIndex('alice', [
      { id: 'k1', type: 'knowledge', timestamp: '2026-10-08T00:00:00.000Z', tags: ['knowledge', '量子'], summary: 'Nighthawk', url: 'https://a.example/q1' },
    ]);
    const res = await app.request(await authed('http://x/api/trail/memory'));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string }[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe('k1');
  });

  it('GET /api/trail/speaks：聚合 speaks JSONL，gated/url/matchedTopics 透出', async () => {
    seedSpeaks('alice', [
      { content: '喵', timestamp: '2026-10-08T16:04:00.000Z', title: '量子大瓜', url: 'https://a.example/q1', matchedTopics: ['量子'] },
      { content: '被拦', timestamp: '2026-10-08T16:05:00.000Z', title: '被拦叼回', gated: true },
    ]);
    const res = await app.request(await authed('http://x/api/trail/speaks'));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { title: string; gated?: boolean; url?: string }[] };
    expect(body.data).toHaveLength(2);
    expect(body.data[0]?.url).toBe('https://a.example/q1');
    expect(body.data[1]?.gated).toBe(true);
  });

  it('无数据文件 → 200 空数组（合法空态）', async () => {
    const mem = await app.request(await authed('http://x/api/trail/memory'));
    expect(mem.status).toBe(200);
    expect(((await mem.json()) as { data: unknown[] }).data).toEqual([]);
    const speaks = await app.request(await authed('http://x/api/trail/speaks'));
    expect(speaks.status).toBe(200);
    expect(((await speaks.json()) as { data: unknown[] }).data).toEqual([]);
  });

  it('损坏的记忆索引 → 500（禁兜底）', async () => {
    const dir = join(tenantDataDir(dataDir, 'alice'), 'memory');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.index.json'), '{broken');
    const res = await app.request(await authed('http://x/api/trail/memory'));
    expect(res.status).toBe(500);
  });

  it('未登录 401；跨租户不泄漏（bob 看不到 alice 的记忆）', async () => {
    seedMemoryIndex('alice', [{ id: 'k1', type: 'knowledge', timestamp: 't', tags: [], summary: 's' }]);
    const unauth = await app.request('http://x/api/trail/memory');
    expect(unauth.status).toBe(401);
    const bobRes = await app.request(await authed('http://x/api/trail/memory', { sub: 'bob', tenantId: 'bob' }));
    expect(((await bobRes.json()) as { data: unknown[] }).data).toEqual([]);
  });
});
