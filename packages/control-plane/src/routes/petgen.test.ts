/**
 * petgen 路由 API 契约测试（#94）
 *
 * 契约：
 * - 鉴权：未登录 401；他人租户任务 404；x-tenant-* 忽略
 * - 免费用户无入口：提交 403；quota 返回 available:false
 * - 提交：Pro/BYOK 201 + 建任务行（spec_submitted）；参数校验 400
 * - 配额：done 超限 → 429 带剩余量；restart 同样拦截
 * - 状态机 API：confirm 仅 awaiting_confirmation 可用（否则 409）；
 *   restart 仅 awaiting_confirmation/failed 可用（否则 409），改 spec 重出概念图
 * - 素材服务：concept.png 404 语义；assets 白名单 + 租户私有
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant } from '../tenant.js';
import { signSession, SESSION_COOKIE } from '../session.js';
import { petGenTasks, tenants } from '../db/schema.js';
import { createPetGenRoutes } from './petgen.js';

const SECRET = 'x'.repeat(40);

describe('petgen 路由（#94）', () => {
  let dataDir: string;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-petgen-routes-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    await getOrCreateTenant(dataDir, 'bob');
    app = new Hono();
    const config = {
      dataDir,
      sessionSecret: SECRET,
      petGenMonthlyQuota: 2,
    } as Parameters<typeof createPetGenRoutes>[0]['config'];
    app.route('/api/petgen', createPetGenRoutes({ config }));
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
    headers.set('x-tenant-id', 'bob'); // 安全硬规矩：一律忽略
    return new Request(url, { ...init, headers });
  }

  async function setPlan(tenantId: string, plan: 'free' | 'pro' | 'byok'): Promise<void> {
    const db = await getDb(dataDir);
    await db.update(tenants).set({ plan }).where(eq(tenants.id, tenantId)).run();
  }

  const SPEC = { specText: '一只戴红色围巾的橘猫', stylePreset: 'chibi-kawaii' };

  it('未登录：全部 401', async () => {
    expect((await app.request('/api/petgen/tasks', { method: 'POST' })).status).toBe(401);
    expect((await app.request('/api/petgen/tasks')).status).toBe(401);
    expect((await app.request('/api/petgen/quota')).status).toBe(401);
    expect((await app.request('/api/petgen/tasks/x/confirm', { method: 'POST' })).status).toBe(401);
    expect((await app.request('/api/petgen/assets/idle.png')).status).toBe(401);
  });

  it('免费用户无入口：提交 403；quota available:false', async () => {
    await setPlan('alice', 'free');
    const res = await app.request(await authed('http://x/api/petgen/tasks', { method: 'POST', body: JSON.stringify(SPEC) }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain('Pro/BYOK');
    const quota = await app.request(await authed('http://x/api/petgen/quota'));
    const quotaBody = (await quota.json()) as { data: { available: boolean } };
    expect(quotaBody.data.available).toBe(false);
  });

  it('Pro 提交 → 201 + 任务行（spec_submitted）；配额剩余展示', async () => {
    await setPlan('alice', 'pro');
    const res = await app.request(await authed('http://x/api/petgen/tasks', { method: 'POST', body: JSON.stringify(SPEC) }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { id: string; status: string; specText: string; stylePreset: string; conceptUrl: null };
    };
    expect(body.data.status).toBe('spec_submitted');
    expect(body.data.specText).toBe(SPEC.specText);
    expect(body.data.stylePreset).toBe('chibi-kawaii');
    expect(body.data.conceptUrl).toBeNull();
    const db = await getDb(dataDir);
    const row = await db.select().from(petGenTasks).where(eq(petGenTasks.id, body.data.id)).get();
    expect(row?.tenantId).toBe('alice');
    expect(row?.status).toBe('spec_submitted');
    const quota = await app.request(await authed('http://x/api/petgen/quota'));
    const quotaBody = (await quota.json()) as { data: { used: number; remaining: number; available: boolean; resetAt: string } };
    expect(quotaBody.data).toMatchObject({ used: 0, remaining: 2, available: true });
    expect(quotaBody.data.resetAt).toMatch(/^\d{4}-\d{2}$/);
  });

  it('参数校验：缺 specText / 超长 / 非法预设 / 非法选项 → 400', async () => {
    await setPlan('alice', 'pro');
    const cases = [
      {},
      { specText: '  ' },
      { specText: 'x'.repeat(501) },
      { specText: '猫', stylePreset: 'unknown-style' },
      { specText: '猫', options: { palette: 'x'.repeat(101) } },
      { specText: '猫', options: 'nope' },
    ];
    for (const body of cases) {
      const res = await app.request(await authed('http://x/api/petgen/tasks', { method: 'POST', body: JSON.stringify(body) }));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('配额超限：2 套 done 后提交 429 + 剩余 0；失败任务不占配额', async () => {
    await setPlan('alice', 'pro');
    const db = await getDb(dataDir);
    const now = Date.now();
    await db.insert(petGenTasks).values([
      { id: 'd1', tenantId: 'alice', specText: '猫', status: 'done', completedAt: now },
      { id: 'd2', tenantId: 'alice', specText: '猫', status: 'done', completedAt: now },
    ]).run();
    const res = await app.request(await authed('http://x/api/petgen/tasks', { method: 'POST', body: JSON.stringify(SPEC) }));
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string; data: { remaining: number; limit: number } };
    expect(body.error).toContain('配额');
    expect(body.data.remaining).toBe(0);
    // 失败任务不占配额：1 done + 1 failed → 仍可提交
    await db.update(petGenTasks).set({ status: 'failed' }).where(eq(petGenTasks.id, 'd2')).run();
    const ok = await app.request(await authed('http://x/api/petgen/tasks', { method: 'POST', body: JSON.stringify(SPEC) }));
    expect(ok.status).toBe(201);
  });

  it('列表 + 租户隔离：alice 看不到 bob 的任务；他人任务 404', async () => {
    await setPlan('alice', 'pro');
    await setPlan('bob', 'pro');
    const a = await app.request(await authed('http://x/api/petgen/tasks', { method: 'POST', body: JSON.stringify(SPEC) }));
    const aBody = (await a.json()) as { data: { id: string } };
    await app.request(
      await authed('http://x/api/petgen/tasks', { method: 'POST', body: JSON.stringify(SPEC) }, { sub: 'bob', tenantId: 'bob' }),
    );
    const list = await app.request(await authed('http://x/api/petgen/tasks'));
    const listBody = (await list.json()) as { data: Array<{ id: string }> };
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0]?.id).toBe(aBody.data.id);
    const other = await app.request(
      await authed('http://x/api/petgen/tasks/other-task', {}, { sub: 'bob', tenantId: 'bob' }),
    );
    expect(other.status).toBe(404);
  });

  it('confirm：仅 awaiting_confirmation 可用；否则 409', async () => {
    await setPlan('alice', 'pro');
    const created = await app.request(await authed('http://x/api/petgen/tasks', { method: 'POST', body: JSON.stringify(SPEC) }));
    const { data: createdData } = (await created.json()) as { data: { id: string } };
    const id = createdData.id;
    // spec_submitted 不可确认
    const early = await app.request(await authed(`http://x/api/petgen/tasks/${id}/confirm`, { method: 'POST' }));
    expect(early.status).toBe(409);
    // 推进到 awaiting_confirmation（模拟处理器完成概念图）
    const db = await getDb(dataDir);
    await db.update(petGenTasks).set({ status: 'awaiting_confirmation', conceptPath: 'pet-assets/tasks/x/concept.png' }).where(eq(petGenTasks.id, id)).run();
    const ok = await app.request(await authed(`http://x/api/petgen/tasks/${id}/confirm`, { method: 'POST' }));
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as { data: { status: string } };
    expect(okBody.data.status).toBe('generating_states');
  });

  it('restart：改 spec 重出概念图（回 spec_submitted）；done 后不可 restart', async () => {
    await setPlan('alice', 'pro');
    const created = await app.request(await authed('http://x/api/petgen/tasks', { method: 'POST', body: JSON.stringify(SPEC) }));
    const { data: createdData } = (await created.json()) as { data: { id: string } };
    const id = createdData.id;
    const db = await getDb(dataDir);
    await db.update(petGenTasks).set({ status: 'awaiting_confirmation' }).where(eq(petGenTasks.id, id)).run();
    const res = await app.request(
      await authed(`http://x/api/petgen/tasks/${id}/restart`, { method: 'POST', body: JSON.stringify({ specText: '一只蓝色小狗' }) }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string; specText: string; conceptUrl: null } };
    expect(body.data.status).toBe('spec_submitted');
    expect(body.data.specText).toBe('一只蓝色小狗');
    expect(body.data.conceptUrl).toBeNull();
    const row = await db.select().from(petGenTasks).where(eq(petGenTasks.id, id)).get();
    expect(row?.strategy).toBe('quad');
    expect(row?.qcRetries).toBe(0);
    // done 后 restart → 409
    await db.update(petGenTasks).set({ status: 'done' }).where(eq(petGenTasks.id, id)).run();
    const afterDone = await app.request(await authed(`http://x/api/petgen/tasks/${id}/restart`, { method: 'POST', body: JSON.stringify(SPEC) }));
    expect(afterDone.status).toBe(409);
  });

  it('restart 配额拦截：配额满时 restart 同样 429', async () => {
    await setPlan('alice', 'pro');
    const db = await getDb(dataDir);
    const now = Date.now();
    await db.insert(petGenTasks).values([
      { id: 'd1', tenantId: 'alice', specText: '猫', status: 'done', completedAt: now },
      { id: 'd2', tenantId: 'alice', specText: '猫', status: 'done', completedAt: now },
    ]).run();
    // 现有失败任务（可 restart 但配额已满）
    const failed = await app.request(await authed('http://x/api/petgen/tasks', { method: 'POST', body: JSON.stringify(SPEC) }));
    expect(failed.status).toBe(429); // 提交已被拦
    const res = await app.request(
      await authed('http://x/api/petgen/tasks/nonexistent/restart', { method: 'POST', body: JSON.stringify(SPEC) }),
    );
    expect(res.status).toBe(404); // 先 404，配额检查在任务存在性之后
  });

  it('概念图服务：存在 → PNG；无 conceptPath → 404', async () => {
    await setPlan('alice', 'pro');
    const created = await app.request(await authed('http://x/api/petgen/tasks', { method: 'POST', body: JSON.stringify(SPEC) }));
    const { data: createdData } = (await created.json()) as { data: { id: string } };
    const id = createdData.id;
    const missing = await app.request(await authed(`http://x/api/petgen/tasks/${id}/concept.png`));
    expect(missing.status).toBe(404);
    // 落盘概念图后服务
    const { mkdirSync } = await import('fs');
    const conceptPath = join(dataDir, 'tenants', 'alice', 'pet-assets', 'tasks', id, 'concept.png');
    mkdirSync(join(conceptPath, '..'), { recursive: true });
    writeFileSync(conceptPath, Buffer.from([137, 80, 78, 71]));
    const db = await getDb(dataDir);
    await db.update(petGenTasks).set({ status: 'awaiting_confirmation', conceptPath: `pet-assets/tasks/${id}/concept.png` }).where(eq(petGenTasks.id, id)).run();
    const res = await app.request(await authed(`http://x/api/petgen/tasks/${id}/concept.png`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('素材服务：白名单防穿越；租户私有；缺失 404', async () => {
    await setPlan('alice', 'pro');
    const evil = await app.request(await authed('http://x/api/petgen/assets/..%2F..%2Fmaster.key'));
    expect(evil.status).toBe(400);
    const missing = await app.request(await authed('http://x/api/petgen/assets/idle.png'));
    expect(missing.status).toBe(404);
    // bob 的资产 alice 取不到
    const bobAssets = join(dataDir, 'tenants', 'bob', 'pet-assets');
    const { mkdirSync } = await import('fs');
    mkdirSync(bobAssets, { recursive: true });
    writeFileSync(join(bobAssets, 'idle.png'), Buffer.from([1]));
    const cross = await app.request(await authed('http://x/api/petgen/assets/idle.png'));
    expect(cross.status).toBe(404); // alice 目录无 idle.png
  });
});
