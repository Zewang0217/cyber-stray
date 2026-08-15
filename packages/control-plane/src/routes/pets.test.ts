/**
 * pets 路由测试（S7，#74）
 *
 * 契约：
 * - GET /api/pets：鉴权；返回当前租户宠物列表（空数组 = 未领养）
 * - POST /api/pets/adopt：鉴权；起名 + 初始兴趣（默认给，可改）；
 *   建 pets 行 + 数据目录 + interests.json 种子（与 agent InterestGraph
 *   schema 兼容：version 1 / weight 0.5 / source 'default'）
 * - 幂等：已有宠物 → 409（返回现有，不重复建）
 * - 种子不覆盖：interests.json 已存在（租户已游荡）→ 不写，只建宠物行
 * - 租户隔离：A 的 adopt 不影响 B 的列表
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { pets } from '../db/schema.js';
import { getOrCreateTenant } from '../tenant.js';
import { signSession, SESSION_COOKIE } from '../session.js';
import { createPetsRoutes } from './pets.js';

const SECRET = 'x'.repeat(40);

describe('pets 路由（领养）', () => {
  let dataDir: string;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-pets-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    await getOrCreateTenant(dataDir, 'bob');
    app = new Hono();
    const config = { dataDir, sessionSecret: SECRET } as Parameters<
      typeof createPetsRoutes
    >[0]['config'];
    app.route('/api', createPetsRoutes({ config }));
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
    return new Request(url, { ...init, headers });
  }

  it('未登录：GET/POST 均 401', async () => {
    expect((await app.request('/api/pets')).status).toBe(401);
    expect(
      (await app.request('/api/pets/adopt', { method: 'POST' })).status,
    ).toBe(401);
  });

  it('GET /api/pets：未领养返回空数组', async () => {
    const res = await app.request(await authed('http://x/api/pets'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it('adopt：建宠物行 + interests.json 种子', async () => {
    const res = await app.request(
      await authed('http://x/api/pets/adopt', {
        method: 'POST',
        body: JSON.stringify({ name: '小溜', interests: ['AI', '机器人'] }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { name: string; tenantId: string; status: string; plan: string };
    };
    expect(body.data.name).toBe('小溜');
    expect(body.data.tenantId).toBe('alice');
    expect(body.data.status).toBe('active');
    expect(body.data.plan).toBe('free');

    // 种子落盘：与 agent InterestGraphData schema 兼容
    const seedPath = join(dataDir, 'tenants', 'alice', 'interests.json');
    expect(existsSync(seedPath)).toBe(true);
    const seed = JSON.parse(readFileSync(seedPath, 'utf-8')) as {
      version: number;
      nodes: Array<{ id: string; weight: number; source: string }>;
    };
    expect(seed.version).toBe(1);
    expect(seed.nodes.map((n) => n.id)).toEqual(['AI', '机器人']);
    expect(seed.nodes.every((n) => n.weight === 0.5 && n.source === 'default')).toBe(true);
    // GET /api/pets 现在返回 1 只；pets 表恰好 1 行
    const list = await app.request(await authed('http://x/api/pets'));
    const listBody = (await list.json()) as { data: unknown[] };
    expect(listBody.data).toHaveLength(1);
    const db = await getDb(dataDir);
    expect((await db.select().from(pets).all()).length).toBe(1);
  });

  it('adopt 无 interests：默认种子（科技/AI/互联网）', async () => {
    const res = await app.request(
      await authed('http://x/api/pets/adopt', {
        method: 'POST',
        body: JSON.stringify({ name: '阿溜' }),
      }),
    );
    expect(res.status).toBe(201);
    const seed = JSON.parse(
      readFileSync(join(dataDir, 'tenants', 'alice', 'interests.json'), 'utf-8'),
    ) as { nodes: Array<{ id: string }> };
    expect(seed.nodes.map((n) => n.id)).toEqual(['科技', 'AI', '互联网']);
  });

  it('adopt 幂等冲突：已有宠物 → 409 返回现有', async () => {
    await app.request(
      await authed('http://x/api/pets/adopt', {
        method: 'POST',
        body: JSON.stringify({ name: '小溜' }),
      }),
    );
    const res = await app.request(
      await authed('http://x/api/pets/adopt', {
        method: 'POST',
        body: JSON.stringify({ name: '另一只' }),
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { data: { name: string } };
    expect(body.data.name).toBe('小溜'); // 返回现有，不重复建

    const db = await getDb(dataDir);
    const { pets } = await import('../db/schema.js');
    expect((await db.select().from(pets).all()).length).toBe(1);
  });

  it('种子不覆盖：interests.json 已存在 → 不写只建宠物行', async () => {
    const seedPath = join(dataDir, 'tenants', 'alice', 'interests.json');
    writeFileSync(
      seedPath,
      JSON.stringify({ version: 1, lastUpdated: '2026-08-01T00:00:00Z', nodes: [] }),
    );
    const res = await app.request(
      await authed('http://x/api/pets/adopt', {
        method: 'POST',
        body: JSON.stringify({ name: '小溜', interests: ['不该写入'] }),
      }),
    );
    expect(res.status).toBe(201);
    // 原文件未被覆盖（lastUpdated 保持原值）
    const seed = JSON.parse(readFileSync(seedPath, 'utf-8')) as {
      lastUpdated: string;
      nodes: unknown[];
    };
    expect(seed.lastUpdated).toBe('2026-08-01T00:00:00Z');
    expect(seed.nodes).toHaveLength(0);
  });

  it('参数校验：缺 name / 空 interests 项 → 400', async () => {
    const noName = await app.request(
      await authed('http://x/api/pets/adopt', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
    expect(noName.status).toBe(400);

    const emptyInterest = await app.request(
      await authed('http://x/api/pets/adopt', {
        method: 'POST',
        body: JSON.stringify({ name: '小溜', interests: [''] }),
      }),
    );
    expect(emptyInterest.status).toBe(400);
  });

  it('租户隔离：alice adopt 后 bob 列表仍空', async () => {
    await app.request(
      await authed('http://x/api/pets/adopt', {
        method: 'POST',
        body: JSON.stringify({ name: '小溜' }),
      }),
    );
    const bobList = await app.request(
      await authed('http://x/api/pets', {}, { sub: 'bob', tenantId: 'bob' }),
    );
    const body = (await bobList.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(0);
  });
});
