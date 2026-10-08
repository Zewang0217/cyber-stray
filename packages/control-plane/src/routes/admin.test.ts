import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant, tenantDataDir } from '../infra/tenant.js';
import { signSession, SESSION_COOKIE } from '../auth/session.js';
import { admins, pets, tenants } from '../db/schema.js';
import { createAdminRoutes } from './admin.js';
import { refreshModelConfig } from '../infra/app-config.js';
import { isInviteToken } from '@cyber-stray/shared/invite';

const SECRET = 'x'.repeat(40);

describe('admin 路由（用户级管理 + RBAC）', () => {
  let dataDir: string;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-admin-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'tenant-a');
    await getOrCreateTenant(dataDir, 'tenant-b');
    await getOrCreateTenant(dataDir, 'tenant-c'); // 无宠物用户
    const db = await getDb(dataDir);
    await db.insert(pets).values({
      id: 'pet-a1', tenantId: 'tenant-a', name: '小溜',
      status: 'active', boredom: 30, energy: 80,
    }).run();
    await db.insert(pets).values({
      id: 'pet-b1', tenantId: 'tenant-b', name: '阿黄',
      status: 'paused', boredom: 55, energy: 40,
    }).run();
    // 租户 b 已是 pro（账号级）
    await db.update(tenants).set({ plan: 'pro' }).where(eq(tenants.id, 'tenant-b')).run();
    // 两个有宠租户写 state 统计
    for (const [tid, w, p] of [['tenant-a', 11, 19], ['tenant-b', 3, 7]] as const) {
      const dir = tenantDataDir(dataDir, tid);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'state.json'), JSON.stringify({ totalWanders: w, totalPushes: p }));
    }

    app = new Hono();
    const config = {
      dataDir, sessionSecret: SECRET, productMode: 'paid', webOrigin: 'https://app.example.com',
      adminSubs: ['admin-1'], // env bootstrap
      arkImageModel: 'default-img',
      visionModel: 'default-vl',
    } as Parameters<typeof createAdminRoutes>[0]['config'];
    app.route('/api/admin', createAdminRoutes({ config }));
  });

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function authed(
    url: string,
    init: RequestInit = {},
    claims = { sub: 'admin-1', tenantId: 'tenant-a' },
  ): Promise<Request> {
    const token = await signSession(claims, SECRET);
    const headers = new Headers(init.headers);
    headers.set('cookie', `${SESSION_COOKIE}=${token}`);
    headers.set('content-type', 'application/json');
    return new Request(url, { ...init, headers });
  }

  it('GET /api/admin/users：列出全部用户（含无宠物用户），plan 来自账号层', async () => {
    const res = await app.request(await authed('http://x/api/admin/users'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(json.data).toHaveLength(3);
    const a = json.data.find((u) => u.tenantId === 'tenant-a');
    expect(a?.petName).toBe('小溜');
    expect(a?.plan).toBe('free');
    expect(a?.totalWanders).toBe(11);
    const b = json.data.find((u) => u.tenantId === 'tenant-b');
    expect(b?.plan).toBe('pro');
    const c = json.data.find((u) => u.tenantId === 'tenant-c');
    expect(c?.petName).toBeNull();
    expect(c?.plan).toBe('free');
  });

  it('GET /api/admin/whoami：管理员 true / 已登录普通用户 200 false / 未登录 401', async () => {
    const admin = await app.request(await authed('http://x/api/admin/whoami'));
    expect(admin.status).toBe(200);
    expect(((await admin.json()) as { data: { admin: boolean } }).data.admin).toBe(true);

    const plain = await app.request(
      await authed('http://x/api/admin/whoami', {}, { sub: 'tenant-a', tenantId: 'tenant-a' }),
    );
    expect(plain.status).toBe(200);
    expect(((await plain.json()) as { data: { admin: boolean } }).data.admin).toBe(false);

    const anon = await app.request('http://x/api/admin/whoami');
    expect(anon.status).toBe(401);
  });

  it('PUT /api/admin/users/:id/plan：改用户套餐（账号层，非宠物层）', async () => {
    const res = await app.request(
      await authed('http://x/api/admin/users/tenant-a/plan', {
        method: 'PUT', body: JSON.stringify({ plan: 'pro' }),
      }),
    );
    expect(res.status).toBe(200);
    const db = await getDb(dataDir);
    const t = await db.select().from(tenants).where(eq(tenants.id, 'tenant-a')).get();
    expect(t?.plan).toBe('pro');
    // 宠物行 plan 列已废弃（S14 迁移），不应再读
    const pet = await db.select().from(pets).where(eq(pets.tenantId, 'tenant-a')).get();
    expect(pet?.plan).toBe('free');
  });

  it('管理员注销：理由必填；成功软删 + 宠物停派 + 列表可见注销状态', async () => {
    const noReason = await app.request(await authed('http://x/api/admin/users/tenant-a/account-deletion', {
      method: 'POST', body: JSON.stringify({ reason: '   ' }),
    }));
    expect(noReason.status).toBe(400);

    const res = await app.request(await authed('http://x/api/admin/users/tenant-a/account-deletion', {
      method: 'POST', body: JSON.stringify({ reason: '测试清理' }),
    }));
    expect(res.status).toBe(200);
    const db = await getDb(dataDir);
    const t = await db.select().from(tenants).where(eq(tenants.id, 'tenant-a')).get();
    expect(t?.deletedAt).not.toBeNull();
    expect(t?.deletionMode).toBe('admin');
    expect(t?.deletionReason).toBe('测试清理');
    expect(t?.deletedBy).toBe('admin-1');
    expect((await db.select().from(pets).where(eq(pets.tenantId, 'tenant-a')).get())?.status).toBe('paused');

    const list = await app.request(await authed('http://x/api/admin/users'));
    const rows = ((await list.json()) as {
      data: Array<{ tenantId: string; deletedAt: number | null; deletionMode: string | null }>;
    }).data;
    expect(rows.find((r) => r.tenantId === 'tenant-a')?.deletedAt).not.toBeNull();
    expect(rows.find((r) => r.tenantId === 'tenant-a')?.deletionMode).toBe('admin');
    expect(rows.find((r) => r.tenantId === 'tenant-b')?.deletedAt).toBeNull();
  });

  it('管理员账号不可注销：先撤销其管理员身份', async () => {
    await getOrCreateTenant(dataDir, 'admin-1');
    const res = await app.request(await authed('http://x/api/admin/users/admin-1/account-deletion', {
      method: 'POST', body: JSON.stringify({ reason: '误操作' }),
    }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('管理员账号不可注销');
    const db = await getDb(dataDir);
    expect((await db.select().from(tenants).where(eq(tenants.id, 'admin-1')).get())?.deletedAt).toBeNull();
  });

  it('批量注销：逐项独立成败（不存在的记入明细，不影响其余）', async () => {
    const bad = await app.request(await authed('http://x/api/admin/account-deletions', {
      method: 'POST', body: JSON.stringify({ tenantIds: [], reason: '批量清理' }),
    }));
    expect(bad.status).toBe(400);

    const res = await app.request(await authed('http://x/api/admin/account-deletions', {
      method: 'POST', body: JSON.stringify({ tenantIds: ['tenant-a', 'ghost', 'tenant-b'], reason: '批量清理' }),
    }));
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { results: Array<{ tenantId: string; ok: boolean }> } };
    expect(data.results).toEqual([
      { tenantId: 'tenant-a', ok: true },
      expect.objectContaining({ tenantId: 'ghost', ok: false }),
      { tenantId: 'tenant-b', ok: true },
    ]);
    const db = await getDb(dataDir);
    expect((await db.select().from(pets).where(eq(pets.tenantId, 'tenant-b')).get())?.status).toBe('paused');
  });

  it('配额覆盖：写入 / 整体替换 / 清空，listUsers 回显；非法值与未知键拒绝', async () => {
    const put = await app.request(await authed('http://x/api/admin/users/tenant-a/quota-overrides', {
      method: 'PUT', body: JSON.stringify({ llmBudgetYuan: 5, petgenWeeklyLimit: 2 }),
    }));
    expect(put.status).toBe(200);
    expect(((await put.json()) as { data: { quotaOverrides: unknown } }).data.quotaOverrides)
      .toEqual({ llmBudgetYuan: 5, petgenWeeklyLimit: 2 });
    const db = await getDb(dataDir);
    expect((await db.select().from(tenants).where(eq(tenants.id, 'tenant-a')).get())?.quotaOverrides)
      .toBe('{"llmBudgetYuan":5,"petgenWeeklyLimit":2}');

    // 整体替换语义：只提交一个键 → 旧键被清除
    await app.request(await authed('http://x/api/admin/users/tenant-a/quota-overrides', {
      method: 'PUT', body: JSON.stringify({ petgenWeeklyLimit: 0 }),
    }));
    const list = await app.request(await authed('http://x/api/admin/users'));
    const row = ((await list.json()) as { data: Array<{ tenantId: string; quotaOverrides: unknown }> }).data
      .find((r) => r.tenantId === 'tenant-a');
    expect(row?.quotaOverrides).toEqual({ petgenWeeklyLimit: 0 });

    expect((await app.request(await authed('http://x/api/admin/users/tenant-a/quota-overrides', {
      method: 'PUT', body: JSON.stringify({ llmBudgetYuan: 9999 }),
    }))).status).toBe(400);
    expect((await app.request(await authed('http://x/api/admin/users/tenant-a/quota-overrides', {
      method: 'PUT', body: JSON.stringify({ unknownKey: 1 }),
    }))).status).toBe(400);
    expect((await app.request(await authed('http://x/api/admin/users/ghost/quota-overrides', {
      method: 'PUT', body: JSON.stringify({ llmBudgetYuan: 1 }),
    }))).status).toBe(404);

    // 全空对象 = 清空回套餐默认
    await app.request(await authed('http://x/api/admin/users/tenant-a/quota-overrides', {
      method: 'PUT', body: JSON.stringify({}),
    }));
    expect((await db.select().from(tenants).where(eq(tenants.id, 'tenant-a')).get())?.quotaOverrides).toBeNull();
  });

  it('管理员生成的邀请保留根路径链接及共享契约令牌，供 Web 首次登录透传', async () => {
    const res = await app.request(await authed('http://x/api/admin/invites', {
      method: 'POST', body: JSON.stringify({ label: '首次领养邀请' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { token: string; link: string } };
    expect(isInviteToken(body.data.token)).toBe(true);
    const link = new URL(body.data.link);
    expect(link.origin).toBe('https://app.example.com');
    expect(link.pathname).toBe('/');
    expect(link.searchParams.get('invite')).toBe(body.data.token);
    expect(Array.from(link.searchParams.keys())).toEqual(['invite']);
  });

  it('邀请内测统一显示 Pro，并拒绝管理员改写存量套餐', async () => {
    const beta = new Hono();
    beta.route('/api/admin', createAdminRoutes({ config: {
      dataDir, sessionSecret: SECRET, productMode: 'invite_beta', adminSubs: ['admin-1'],
      arkImageModel: 'default-img', visionModel: 'default-vl', webOrigin: 'http://localhost:3000',
      llmBudgetEnabled: true, llmBudgetYuan: { free: 0.5, pro: 2, byok: 2 },
    } }));
    const list = await beta.request(await authed('http://x/api/admin/users'));
    const body = await list.json() as { data: Array<{ plan: string; mode: string }> };
    expect(body.data.every((row) => row.plan === 'pro' && row.mode === 'invite_beta')).toBe(true);
    const update = await beta.request(await authed('http://x/api/admin/users/tenant-a/plan', {
      method: 'PUT', body: JSON.stringify({ plan: 'byok' }),
    }));
    expect(update.status).toBe(400);
    expect((await (await getDb(dataDir)).select().from(tenants).where(eq(tenants.id, 'tenant-a')).get())?.plan).toBe('free');
  });

  it('RBAC：admins 表判定（非 env 白名单但入表）可访问', async () => {
    const db = await getDb(dataDir);
    await db.insert(admins).values({ sub: 'promoted-1', grantedBy: 'admin-1' }).run();
    const res = await app.request(
      await authed('http://x/api/admin/users', {}, { sub: 'promoted-1', tenantId: 'tenant-a' }),
    );
    expect(res.status).toBe(200);
  });

  it('RBAC：既非 env 白名单又非 admins 表 → 403', async () => {
    const res = await app.request(
      await authed('http://x/api/admin/users', {}, { sub: 'evil-user', tenantId: 'tenant-b' }),
    );
    expect(res.status).toBe(403);
  });

  it('GET /api/admin/admins：管理员列表；POST 添加（管理员授权）；DELETE 移除', async () => {
    // 列表（env bootstrap 的 admin-1 也应出现，来源 env）
    let res = await app.request(await authed('http://x/api/admin/admins'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ sub: string }> };
    expect(json.data.map((a) => a.sub)).toContain('admin-1');

    // 添加新管理员
    res = await app.request(
      await authed('http://x/api/admin/admins', {
        method: 'POST', body: JSON.stringify({ sub: 'new-admin' }),
      }),
    );
    expect(res.status).toBe(200);
    const db = await getDb(dataDir);
    const row = await db.select().from(admins).where(eq(admins.sub, 'new-admin')).get();
    expect(row?.grantedBy).toBe('admin-1');

    // 新管理员现在可访问
    res = await app.request(
      await authed('http://x/api/admin/users', {}, { sub: 'new-admin', tenantId: 'tenant-a' }),
    );
    expect(res.status).toBe(200);

    // 移除
    res = await app.request(
      await authed('http://x/api/admin/admins/new-admin', { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    const gone = await db.select().from(admins).where(eq(admins.sub, 'new-admin')).get();
    expect(gone).toBeUndefined();
  });

  it('PUT /api/admin/users/:id/pet-status：暂停/恢复宠物', async () => {
    const res = await app.request(
      await authed('http://x/api/admin/users/tenant-a/pet-status', {
        method: 'PUT', body: JSON.stringify({ status: 'paused' }),
      }),
    );
    expect(res.status).toBe(200);
    const db = await getDb(dataDir);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, 'tenant-a')).get();
    expect(pet?.status).toBe('paused');
  });

  it('DELETE /admins：自撤 → 400；末位管理员（无 env 兜底）→ 400', async () => {
    const db = await getDb(dataDir);
    // 自撤
    const selfRevoke = await app.request(
      await authed('http://x/api/admin/admins/admin-1', { method: 'DELETE' }),
    );
    expect(selfRevoke.status).toBe(400);

    // app2：env 白名单为空（生产形态），admin-1 先入表才能操作
    const emptyEnvConfig = {
      dataDir, sessionSecret: SECRET, adminSubs: [],
      webOrigin: 'http://localhost:3000',
      arkImageModel: 'default-img',
      visionModel: 'default-vl',
      llmBudgetEnabled: true,
      llmBudgetYuan: { free: 0.5, pro: 2, byok: 2 },
    } as Parameters<typeof createAdminRoutes>[0]['config'];
    const app2 = new Hono();
    app2.route('/api/admin', createAdminRoutes({ config: emptyEnvConfig }));
    await db.insert(admins).values({ sub: 'admin-1', grantedBy: 'admin-1' }).run();
    // 表内仅 1 人（admin-1），撤销 promoted-1 不存在 → 404（且非末位保护生效场景）；
    // 正确场景：先给表加 1 人，撤销后剩 1 人 = 非末位 → 允许
    await db.insert(admins).values({ sub: 'promoted-1', grantedBy: 'admin-1' }).run();
    const ok = await app2.request(
      await authed('http://x/api/admin/admins/promoted-1', { method: 'DELETE' }, { sub: 'admin-1', tenantId: 'tenant-a' }),
    );
    expect(ok.status).toBe(200);

    // 末位保护：表内只剩 admin-1，撤销自己 → 400（自撤）
    const self2 = await app2.request(
      await authed('http://x/api/admin/admins/admin-1', { method: 'DELETE' }, { sub: 'admin-1', tenantId: 'tenant-a' }),
    );
    expect(self2.status).toBe(400);
  });

  it('PUT /api/admin/tenants/:id/plan 兼容旧路径（宠物级）不存在 → 404', async () => {
    // 旧端点 /tenants/:id/plan 已移除——返回 404 而非 200
    const res = await app.request(
      await authed('http://x/api/admin/tenants/tenant-a/plan', {
        method: 'PUT', body: JSON.stringify({ plan: 'pro' }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('GET /api/admin/usage：聚合费用/token/张数 + 每租户 + 最近明细', async () => {
    // seed usage 数据：tenant-a 两条 LLM + 一张生图；tenant-b 无用量
    const writeUsage = (tid: string, lines: Array<Record<string, unknown>>) => {
      const dir = join(tenantDataDir(dataDir, tid), 'usage');
      mkdirSync(dir, { recursive: true });
      const today = new Date();
      const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      writeFileSync(
        join(dir, `usage-${date}.jsonl`),
        lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
      );
    };
    writeUsage('tenant-a', [
      { timestamp: '2026-08-25T01:00:00.000Z', tenantId: 'tenant-a', kind: 'llm', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 500_000 },
      { timestamp: '2026-08-25T02:00:00.000Z', tenantId: 'tenant-a', kind: 'image', model: 'doubao-seedream-5-0-260128', images: 1 },
      { timestamp: '2026-08-24T03:00:00.000Z', tenantId: 'tenant-a', kind: 'vision_qc', model: 'glm-4v-flash', images: 1 },
    ]);

    const res = await app.request(await authed('http://x/api/admin/usage'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { summary: Record<string, number>; perTenant: Array<Record<string, unknown>>; recent: Array<Record<string, unknown>> };
    };
    const { summary, perTenant, recent } = json.data;
    expect(summary.totalLlmTokens).toBe(1_500_000);
    expect(summary.totalImages).toBe(1);
    expect(summary.totalVisionQc).toBe(1);
    expect(summary.totalCost).toBeCloseTo(6 + 0.4, 6); // LLM 6 元 + 生图 0.4 元

    const a = perTenant.find((p) => p.tenantId === 'tenant-a');
    expect(a?.llmTokens).toBe(1_500_000);
    expect(a?.imageCount).toBe(1);
    expect(a?.visionCount).toBe(1);
    const b = perTenant.find((p) => p.tenantId === 'tenant-b');
    expect(b?.llmTokens).toBe(0);
    expect(b?.cost).toBe(0);

    // #265 水位：主 fixture 未启用预算 → 上限 null；行落在今日文件（本地日
    // 分区）即计入今日——即使行内 timestamp 是历史时间（usage 文件即天分区，
    // 不再按行内 UTC 日期二次筛，见 infra/usage.ts）→ 今日 LLM 成本 6 元
    expect(a?.llmBudgetYuan).toBeNull();
    expect(a?.llmCostToday).toBe(6);

    // 明细降序 + 含 cost
    expect(recent).toHaveLength(3);
    expect(recent[0]?.kind).toBe('image');
    expect(recent[2]?.cost).toBe(0); // glm-4v-flash 免费
  });

  it('GET /api/admin/usage?from/to：时间范围筛选文件与行', async () => {
    const dir = join(tenantDataDir(dataDir, 'tenant-a'), 'usage');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'usage-2026-08-20.jsonl'), JSON.stringify({ timestamp: '2026-08-20T01:00:00.000Z', tenantId: 'tenant-a', kind: 'llm', model: 'deepseek-chat', inputTokens: 100, outputTokens: 0 }) + '\n');
    writeFileSync(join(dir, 'usage-2026-08-25.jsonl'), JSON.stringify({ timestamp: '2026-08-25T01:00:00.000Z', tenantId: 'tenant-a', kind: 'llm', model: 'deepseek-chat', inputTokens: 200, outputTokens: 0 }) + '\n');

    const res = await app.request(await authed('http://x/api/admin/usage?from=2026-08-22&to=2026-08-25'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { summary: { totalLlmTokens: number } } };
    expect(json.data.summary.totalLlmTokens).toBe(200); // 20 日的文件被排除
  });

  it('GET /api/admin/usage：非法日期 → 400；非管理员 → 403', async () => {
    const bad = await app.request(await authed('http://x/api/admin/usage?from=abc'));
    expect(bad.status).toBe(400);
    const forbidden = await app.request(
      await authed('http://x/api/admin/usage', {}, { sub: 'evil-user', tenantId: 'tenant-b' }),
    );
    expect(forbidden.status).toBe(403);
  });

  it('GET /api/admin/config：返回默认模型 + 候选下拉', async () => {
    await refreshModelConfig(dataDir, { imageModel: 'default-img', visionModel: 'default-vl' });
    const res = await app.request(await authed('http://x/api/admin/config'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { imageModel: string; visionModel: string; candidates: Record<string, string[]> } };
    expect(json.data.imageModel).toBe('default-img');
    expect(json.data.visionModel).toBe('default-vl');
    expect(json.data.candidates.image).toContain('doubao-seedream-5-0-260128');
  });

  it('PUT /api/admin/config：写 DB 生效，下次 GET 读到新值', async () => {
    await refreshModelConfig(dataDir, { imageModel: 'doubao-seedream-5-0-260128', visionModel: 'glm-4v-flash' });
    const res = await app.request(
      await authed('http://x/api/admin/config', {
        method: 'PUT',
        body: JSON.stringify({ visionModel: 'glm-4.5v' }),
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { imageModel: string; visionModel: string } };
    expect(json.data.imageModel).toBe('doubao-seedream-5-0-260128'); // 未传字段保持
    expect(json.data.visionModel).toBe('glm-4.5v');

    const get = await app.request(await authed('http://x/api/admin/config'));
    const getJson = (await get.json()) as { data: { imageModel: string } };
    expect(getJson.data.imageModel).toBe('doubao-seedream-5-0-260128');
  });

  it('PUT /api/admin/config：未知单价拒绝保存，继续保留已知配置', async () => {
    const current = { imageModel: 'doubao-seedream-5-0-260128', visionModel: 'glm-4v-flash' };
    await refreshModelConfig(dataDir, current);
    const res = await app.request(await authed('http://x/api/admin/config', {
      method: 'PUT', body: JSON.stringify({ imageModel: 'unknown-model' }),
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('未知模型单价') });
    expect(await refreshModelConfig(dataDir, current)).toEqual(current);
  });

  it('PUT /api/admin/config：空/超长模型 ID → 400；非管理员 → 403', async () => {
    const bad = await app.request(
      await authed('http://x/api/admin/config', {
        method: 'PUT',
        body: JSON.stringify({ imageModel: '' }),
      }),
    );
    expect(bad.status).toBe(400);
    const long = await app.request(
      await authed('http://x/api/admin/config', {
        method: 'PUT',
        body: JSON.stringify({ imageModel: 'x'.repeat(101) }),
      }),
    );
    expect(long.status).toBe(400);
    const forbidden = await app.request(
      await authed('http://x/api/admin/config', {
        method: 'PUT',
        body: JSON.stringify({ imageModel: 'm' }),
      }, { sub: 'evil-user', tenantId: 'tenant-b' }),
    );
    expect(forbidden.status).toBe(403);
  });
});
