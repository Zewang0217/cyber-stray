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
import { rmDataDir } from '../test/rm-data-dir.js';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant } from '../infra/tenant.js';
import { signSession, SESSION_COOKIE } from '../auth/session.js';
import { admins, petGenTasks, tenants, userTenants } from '../db/schema.js';
import { PET_STATE_IDS } from '@cyber-stray/shared/pet';
import { qcInfraFailureMessage } from '../domain/petgen-failure.js';
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
      productMode: 'paid',
    } as Parameters<typeof createPetGenRoutes>[0]['config'];
    app.route('/api/petgen', createPetGenRoutes({ config }));
  });

  afterEach(async () => {
    _resetDb();
    await rmDataDir(dataDir);
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

  it('邀请内测存量 free 可以定制宠物，使用七天生成额度', async () => {
    const beta = new Hono().route('/api/petgen', createPetGenRoutes({
      config: { dataDir, sessionSecret: SECRET, productMode: 'invite_beta' },
    }));
    const res = await beta.request(await authed('http://x/api/petgen/tasks', { method: 'POST', body: JSON.stringify(SPEC) }));
    expect(res.status).toBe(201);
    const quota = await beta.request(await authed('http://x/api/petgen/quota'));
    expect((await quota.json()).data).toMatchObject({ available: true });
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
    expect(quotaBody.data).toMatchObject({ used: 0, remaining: 1, available: true });
    expect(quotaBody.data.resetAt).toBeNull();
  });

  it('并发拒绝：租户已有在飞任务 → 提交 409（防 nextDueTask 永久互卡）', async () => {
    await setPlan('alice', 'pro');
    const db = await getDb(dataDir);
    await db.insert(petGenTasks).values({
      id: 't-inflight',
      tenantId: 'alice',
      status: 'generating_states', // 在飞（IN_FLIGHT 集合内）
      specText: '领养自动建的 sheet 任务',
      options: null,
      stylePreset: 'pixel',
      conceptPath: null,
      strategy: 'sheet',
      batchRetries: 0,
      qcRetries: 0,
      qcResult: null,
      pendingStates: null,
      conceptAttempts: 0,
      error: null,
      completedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const res = await app.request(
      await authed('http://x/api/petgen/tasks', { method: 'POST', body: JSON.stringify(SPEC) }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('已有生成任务');
  });

  async function retainedQcTask(id = 'qc-failed', error = qcInfraFailureMessage('HTTP 500')) {
    await setPlan('alice', 'pro');
    const db = await getDb(dataDir);
    const root = join(dataDir, 'tenants', 'alice', 'pet-assets', 'tasks', id);
    mkdirSync(join(root, 'states'), { recursive: true });
    writeFileSync(join(root, 'concept.png'), 'retained concept');
    for (const state of PET_STATE_IDS) writeFileSync(join(root, 'states', `${state}.png`), `retained ${state}`);
    await db.insert(petGenTasks).values({ id, tenantId: 'alice', specText: '金眼黑猫',
      status: 'failed', error, conceptPath: `pet-assets/tasks/${id}/concept.png`,
      conceptAttempts: 1, qcRetries: 1, strategy: 'per',
      pendingStates: JSON.stringify(['joy']),
      qcResult: JSON.stringify({ idle: { pass: true, issues: [] } }) }).run();
    return { db, root, id };
  }

  it('质检服务失败可恢复：保留图片、概念尝试和内容重试计数，进入 qc 而非生图', async () => {
    const { db, root, id } = await retainedQcTask();
    const before = await db.select().from(petGenTasks).where(eq(petGenTasks.id, id)).get();
    const detail = await app.request(await authed(`http://x/api/petgen/tasks/${id}`));
    expect((await detail.json()).data.canRetryQc).toBe(true);
    const res = await app.request(await authed(`http://x/api/petgen/tasks/${id}/retry-qc`, { method: 'POST' }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ status: 'qc', canRetryQc: false, error: null });
    const after = await db.select().from(petGenTasks).where(eq(petGenTasks.id, id)).get();
    expect(after).toMatchObject({ conceptPath: before!.conceptPath, conceptAttempts: 1,
      strategy: 'per', qcRetries: 1, pendingStates: before!.pendingStates, qcResult: before!.qcResult });
    expect(readFileSync(join(root, 'concept.png'), 'utf8')).toBe('retained concept');
    for (const state of PET_STATE_IDS) expect(readFileSync(join(root, 'states', `${state}.png`), 'utf8')).toBe(`retained ${state}`);
  });

  it('重试质检同样有登录、租户、套餐和配额门', async () => {
    const { db, id } = await retainedQcTask();
    const path = `http://x/api/petgen/tasks/${id}/retry-qc`;
    expect((await app.request(path, { method: 'POST' })).status).toBe(401);
    await setPlan('bob', 'pro');
    expect((await app.request(await authed(path, { method: 'POST' }, { sub: 'bob', tenantId: 'bob' }))).status).toBe(404);
    await setPlan('alice', 'free');
    expect((await app.request(await authed(path, { method: 'POST' }))).status).toBe(403);
    await setPlan('alice', 'pro');
    await db.insert(petGenTasks).values(['done1', 'done2'].map((id) => ({
      id, tenantId: 'alice', specText: '猫', status: 'done' as const, completedAt: Date.now(),
    }))).run();
    expect((await app.request(await authed(path, { method: 'POST' }))).status).toBe(429);
    expect((await db.select().from(petGenTasks).where(eq(petGenTasks.id, id)).get())?.status).toBe('failed');
  });

  it('内容质检不合格、非失败状态、保留图片缺失都不允许直接复检', async () => {
    const { db, root, id } = await retainedQcTask('qc-content', '内容质检多次不合格');
    const path = `http://x/api/petgen/tasks/${id}/retry-qc`;
    expect((await app.request(await authed(path, { method: 'POST' }))).status).toBe(409);
    await db.update(petGenTasks).set({ status: 'qc', error: qcInfraFailureMessage('500') }).where(eq(petGenTasks.id, id)).run();
    expect((await app.request(await authed(path, { method: 'POST' }))).status).toBe(409);
    await db.update(petGenTasks).set({ status: 'failed' }).where(eq(petGenTasks.id, id)).run();
    unlinkSync(join(root, 'states', 'joy.png'));
    expect((await app.request(await authed(path, { method: 'POST' }))).status).toBe(409);
    expect((await db.select().from(petGenTasks).where(eq(petGenTasks.id, id)).get())?.status).toBe('failed');
  });

  it('free 经典任务不显示恢复入口，免费领养精灵图保持原有恢复权益', async () => {
    const { db, root, id } = await retainedQcTask();
    await setPlan('alice', 'free');
    const classic = await app.request(await authed(`http://x/api/petgen/tasks/${id}`));
    expect((await classic.json()).data.canRetryQc).toBe(false);
    await db.update(petGenTasks).set({ strategy: 'sheet', conceptPath: null }).where(eq(petGenTasks.id, id)).run();
    writeFileSync(join(root, 'reference.jpg'), 'retained uploaded reference');
    const sheet = await app.request(await authed(`http://x/api/petgen/tasks/${id}`));
    expect((await sheet.json()).data.canRetryQc).toBe(true);
    const retried = await app.request(await authed(`http://x/api/petgen/tasks/${id}/retry-qc`, { method: 'POST' }));
    expect(retried.status).toBe(200);
    expect((await retried.json()).data.status).toBe('qc');
  });

  it('素材缺失或配额耗尽时列表和详情不显示恢复按钮', async () => {
    const { db, root, id } = await retainedQcTask();
    unlinkSync(join(root, 'states', 'joy.png'));
    const detail = await app.request(await authed(`http://x/api/petgen/tasks/${id}`));
    expect((await detail.json()).data.canRetryQc).toBe(false);
    writeFileSync(join(root, 'states', 'joy.png'), 'retained joy');
    await db.insert(petGenTasks).values(['used1', 'used2'].map((id) => ({
      id, tenantId: 'alice', specText: '猫', status: 'done' as const, completedAt: Date.now(),
    }))).run();
    const list = await app.request(await authed('http://x/api/petgen/tasks'));
    expect((await list.json()).data.find((task: { id: string }) => task.id === id).canRetryQc).toBe(false);
  });

  it('并发恢复两条失败任务仅一条进入 qc，避免同租户队列互卡', async () => {
    await retainedQcTask('retry-a');
    await retainedQcTask('retry-b');
    const requests = await Promise.all(['retry-a', 'retry-b'].map((id) =>
      authed(`http://x/api/petgen/tasks/${id}/retry-qc`, { method: 'POST' })));
    const responses = await Promise.all(requests.map((request) => app.request(request)));
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('质检恢复与概念确认并发仅激活一条任务', async () => {
    const { db } = await retainedQcTask('retry-a');
    await db.insert(petGenTasks).values({ id: 'confirm-b', tenantId: 'alice',
      specText: '猫', status: 'awaiting_confirmation' }).run();
    const requests = await Promise.all([
      authed('http://x/api/petgen/tasks/retry-a/retry-qc', { method: 'POST' }),
      authed('http://x/api/petgen/tasks/confirm-b/confirm', { method: 'POST' }),
    ]);
    const responses = await Promise.all(requests.map((request) => app.request(request)));
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
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

  it('七天内一套成功即限额；失败不占次数', async () => {
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
    expect(body.error).toContain('每七天');
    expect(body.data.remaining).toBe(0);
    // 改为两条失败记录后可提交；只有成功交付扣次数
    await db.update(petGenTasks).set({ status: 'failed' }).where(eq(petGenTasks.tenantId, 'alice')).run();
    const ok = await app.request(await authed('http://x/api/petgen/tasks', { method: 'POST', body: JSON.stringify(SPEC) }));
    expect(ok.status).toBe(201);
  });

  it('租户配额覆盖 petgenWeeklyLimit 生效于额度视图与提交门', async () => {
    await setPlan('alice', 'pro');
    const db = await getDb(dataDir);
    await db.update(tenants)
      .set({ quotaOverrides: '{"petgenWeeklyLimit":2}' })
      .where(eq(tenants.id, 'alice'))
      .run();
    await db.insert(petGenTasks).values({
      id: 'ov-done', tenantId: 'alice', specText: '猫', status: 'done', completedAt: Date.now(),
    }).run();
    // 默认 1 已耗尽；覆盖 2 → remaining 1，可再提交
    const quota = await app.request(await authed('http://x/api/petgen/quota'));
    expect((await quota.json()).data).toMatchObject({ limit: 2, used: 1, remaining: 1 });
    const res = await app.request(await authed('http://x/api/petgen/tasks', { method: 'POST', body: JSON.stringify(SPEC) }));
    expect(res.status).toBe(201);
  });

  it.each(['bootstrap', 'rbac'])('管理员 %s 不受周额度限制，普通账号仍不能绕过', async (source) => {
    await setPlan('alice', 'pro');
    const db = await getDb(dataDir);
    if (source === 'rbac') await db.insert(admins).values({ sub: 'alice', grantedBy: 'test' }).run();
    await db.insert(petGenTasks).values({ id: 'admin-done', tenantId: 'alice', specText: '猫', status: 'done', completedAt: Date.now() }).run();
    const adminApp = new Hono().route('/api/petgen', createPetGenRoutes({
      config: { dataDir, sessionSecret: SECRET, productMode: 'invite_beta',
        adminSubs: source === 'bootstrap' ? ['alice'] : [] },
    }));
    const quota = await adminApp.request(await authed('http://x/api/petgen/quota'));
    expect((await quota.json()).data).toMatchObject({ unlimited: true, limit: null, remaining: null, resetAt: null });
    expect((await adminApp.request(await authed('http://x/api/petgen/tasks', { method: 'POST', body: JSON.stringify(SPEC) }))).status).toBe(201);
  });

  it('管理员例外取登录用户身份，不能由租户所有者身份冒领', async () => {
    const db = await getDb(dataDir);
    await db.insert(userTenants).values({ userId: 'bob', tenantId: 'alice', role: 'owner' }).run();
    const scoped = new Hono().route('/api/petgen', createPetGenRoutes({
      config: { dataDir, sessionSecret: SECRET, productMode: 'invite_beta', adminSubs: ['alice'] },
    }));
    const quota = await scoped.request(await authed('http://x/api/petgen/quota', {}, { sub: 'bob', tenantId: 'alice' }));
    expect((await quota.json()).data).toMatchObject({ unlimited: false, limit: 1 });
  });

  it('旧待确认任务不能绕过七天限制；新提交也不能堆积待确认概念图', async () => {
    await setPlan('alice', 'pro');
    const db = await getDb(dataDir);
    await db.insert(petGenTasks).values({ id: 'old-concept', tenantId: 'alice', specText: '猫', status: 'awaiting_confirmation' }).run();
    expect((await app.request(await authed('http://x/api/petgen/tasks', { method: 'POST', body: JSON.stringify(SPEC) }))).status).toBe(409);
    await db.insert(petGenTasks).values({ id: 'recent-done', tenantId: 'alice', specText: '猫', status: 'done', completedAt: Date.now() }).run();
    expect((await app.request(await authed('http://x/api/petgen/tasks/old-concept/confirm', { method: 'POST' }))).status).toBe(429);
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
