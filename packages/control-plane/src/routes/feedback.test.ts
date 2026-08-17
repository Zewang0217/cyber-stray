/**
 * feedback 路由测试（S9，#76）
 *
 * 契约：
 * - POST /api/feedback {type, messageId}：鉴权；需已领养宠物；
 *   spawn agent feedback-cli（注入 fake spawn），透传 worker 结果
 * - POST /api/boost {topic}：鉴权；需已领养；按 plan 节流
 *   （free 30 天 / pro|byok 1 天，超限 429）；成功更新 lastBoostAt
 * - 租户只由 session claim 决定（x-tenant-* header 一律忽略）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { pets, tenants, userTenants } from '../db/schema.js';
import { getOrCreateTenant } from '../tenant.js';
import { tenantDataDir } from '../tenant.js';
import { signSession, SESSION_COOKIE } from '../session.js';
import { createFeedbackRoutes } from './feedback.js';

const SECRET = 'x'.repeat(40);

/** fake spawn：记录调用、返回可配置结果 */
function makeFakeSpawn(
  exitCode = 0,
  stdout = JSON.stringify({
    ok: true,
    result: { recorded: true, topicsMatched: true, interestReinforced: true },
  }),
) {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const spawnFn = async (cmd: string, args: string[]): Promise<{ exitCode: number; stdout: string }> => {
    calls.push({ cmd, args });
    return { exitCode, stdout };
  };
  return { calls, spawnFn };
}

describe('feedback 路由（点赞/踩 + 顶话题）', () => {
  let dataDir: string;
  let app: Hono;
  let fake: ReturnType<typeof makeFakeSpawn>;

  async function seedPet(claims: { sub: string; tenantId: string }, plan: 'free' | 'pro' | 'byok' = 'free', lastBoostAt: number | null = null): Promise<void> {
    const db = await getDb(dataDir);
    await db.insert(pets).values({
      id: `pet-${claims.tenantId}`,
      tenantId: claims.tenantId,
      name: '小溜',
      status: 'active',
      lastRunAt: null,
      cooldownUntil: null,
      lastBoostAt,
      boredom: 30,
      energy: 80,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();
    // S14：套餐在账号层——plan 夹具写 tenants（pets.plan 已废弃）
    await db.update(tenants).set({ plan }).where(eq(tenants.id, claims.tenantId)).run();
  }

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-feedback-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    fake = makeFakeSpawn();
    app = new Hono();
    const config = { dataDir, sessionSecret: SECRET } as Parameters<
      typeof createFeedbackRoutes
    >[0]['config'];
    app.route('/api', createFeedbackRoutes({ config, spawnFn: fake.spawnFn }));
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
    headers.set('x-tenant-id', 'bob'); // 越权尝试：必须被忽略
    return new Request(url, { ...init, headers });
  }

  it('未登录：POST 均 401', async () => {
    expect((await app.request('/api/feedback', { method: 'POST' })).status).toBe(401);
    expect((await app.request('/api/boost', { method: 'POST' })).status).toBe(401);
  });

  it('无租户关系行：403', async () => {
    const res = await app.request(
      '/api/feedback',
      { method: 'POST' },
    );
    expect(res.status).toBe(401); // 无 cookie
    const req = await authed('http://x/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ type: 'like', messageId: 'om-1' }),
    }, { sub: 'mallory', tenantId: 'alice' }); // mallory 不在 alice 租户
    const res2 = await app.request(req);
    expect(res2.status).toBe(403);
  });

  it('未领养宠物：409', async () => {
    const req = await authed('http://x/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ type: 'like', messageId: 'om-1' }),
    });
    expect((await app.request(req)).status).toBe(409);
  });

  it('like：spawn feedback-cli（租户数据目录）+ 透传 worker 结果', async () => {
    await seedPet({ sub: 'alice', tenantId: 'alice' });
    const req = await authed('http://x/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ type: 'like', messageId: 'om-42' }),
    });
    const res = await app.request(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; data: { topicsMatched: boolean } };
    expect(json.success).toBe(true);
    expect(json.data.topicsMatched).toBe(true);

    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call?.args.join(' ')).toContain('feedback-cli.ts');
    expect(call?.args).toContain('--data-dir');
    expect(call?.args).toContain(tenantDataDir(dataDir, 'alice'));
    expect(call?.args).toContain('--message-id');
    expect(call?.args).toContain('om-42');
  });

  it('参数校验：缺 type / 非法 type / 缺 messageId → 400', async () => {
    await seedPet({ sub: 'alice', tenantId: 'alice' });
    for (const body of [
      JSON.stringify({ messageId: 'om-1' }),
      JSON.stringify({ type: 'meh', messageId: 'om-1' }),
      JSON.stringify({ type: 'like' }),
    ]) {
      const req = await authed('http://x/api/feedback', { method: 'POST', body });
      expect((await app.request(req)).status).toBe(400);
    }
  });

  it('worker 失败（exitCode≠0）：502 显式报错（禁兜底）', async () => {
    fake = makeFakeSpawn(1, '');
    app = new Hono();
    const config = { dataDir, sessionSecret: SECRET } as Parameters<
      typeof createFeedbackRoutes
    >[0]['config'];
    app.route('/api', createFeedbackRoutes({ config, spawnFn: fake.spawnFn }));
    await seedPet({ sub: 'alice', tenantId: 'alice' });

    const req = await authed('http://x/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ type: 'like', messageId: 'om-1' }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(502);
  });

  it('boost：免费首顶成功 + 更新 lastBoostAt；30 天内再顶 429', async () => {
    await seedPet({ sub: 'alice', tenantId: 'alice' }, 'free');
    const req = await authed('http://x/api/boost', {
      method: 'POST',
      body: JSON.stringify({ topic: '量子计算' }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);

    const db = await getDb(dataDir);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, 'alice')).get();
    expect(pet!.lastBoostAt).not.toBeNull();
    expect(fake.calls[0]?.args).toContain('--topic');
    expect(fake.calls[0]?.args).toContain('量子计算');

    const req2 = await authed('http://x/api/boost', {
      method: 'POST',
      body: JSON.stringify({ topic: '天文' }),
    });
    const res2 = await app.request(req2);
    expect(res2.status).toBe(429);
    // 节流拒绝不应 spawn worker
    expect(fake.calls).toHaveLength(1);
  });

  it('boost：pro 套餐 1 天节流（昨天顶过 → 429；31 天前顶过 → 放行）', async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    await seedPet({ sub: 'alice', tenantId: 'alice' }, 'pro', Date.now() - 23 * 60 * 60 * 1000);
    const req = await authed('http://x/api/boost', {
      method: 'POST',
      body: JSON.stringify({ topic: '量子计算' }),
    });
    expect((await app.request(req)).status).toBe(429);

    // 重置为 31 天前（免费间隔之外，pro 更宽松）
    const db = await getDb(dataDir);
    await db.update(pets).set({ lastBoostAt: Date.now() - 31 * dayMs }).where(eq(pets.tenantId, 'alice')).run();
    const req2 = await authed('http://x/api/boost', {
      method: 'POST',
      body: JSON.stringify({ topic: '量子计算' }),
    });
    expect((await app.request(req2)).status).toBe(200);
  });

  it('boost：worker 失败 → 502 且额度回滚（lastBoostAt 复原，可重试）', async () => {
    fake = makeFakeSpawn(1, '');
    app = new Hono();
    const config = { dataDir, sessionSecret: SECRET } as Parameters<
      typeof createFeedbackRoutes
    >[0]['config'];
    app.route('/api', createFeedbackRoutes({ config, spawnFn: fake.spawnFn }));
    await seedPet({ sub: 'alice', tenantId: 'alice' });

    const req = await authed('http://x/api/boost', {
      method: 'POST',
      body: JSON.stringify({ topic: '量子计算' }),
    });
    expect((await app.request(req)).status).toBe(502);

    // 额度已回滚：lastBoostAt 仍为 null，下次可重试（换成功 spawn）
    const db = await getDb(dataDir);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, 'alice')).get();
    expect(pet!.lastBoostAt).toBeNull();
  });

  it('boost：参数校验（空 topic / 超长）→ 400', async () => {
    await seedPet({ sub: 'alice', tenantId: 'alice' });
    for (const topic of ['', ' '.repeat(51), 'x'.repeat(51)]) {
      const req = await authed('http://x/api/boost', { method: 'POST', body: JSON.stringify({ topic }) });
      expect((await app.request(req)).status).toBe(400);
    }
  });
});
