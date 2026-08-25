/**
 * admin 路由 — /api/admin*（S13/S14 运营管理面板）
 *
 * 管理员判定（RBAC，S14）：session.sub ∈ admins 表 ∪ CP_ADMIN_SUBS env 白名单。
 * 身份在 Casdoor（谁可登录），权限在控制面（能做什么）——admin 是"看全部
 * 租户数据"的资源权限，放 Casdoor 会与身份耦合，故在控制面 DB 管理。
 * env 白名单作 bootstrap（首启引导），入表后可移除。
 *
 * 用户级管理（S14）：套餐在账号层（tenants.plan，非 pets.plan）；
 * GET /api/admin/users 列出全部用户（含无宠物），PUT plan 改账号套餐。
 */

import { Hono } from 'hono';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { admins, pets, tenants } from '../db/schema.js';
import { tenantDataDir } from '../tenant.js';
import { PLAN_VALUES, type PlanValue } from '../plan/limits.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';
import { resolveTenantFromRequest } from '../request-tenant.js';
import { costOf, type UsageRow } from '../pricing.js';

export interface AdminDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret' | 'adminSubs'>;
}

const jsonError = (message: string) => ({ success: false, error: message });

/** 管理员判定：session 有效且 sub ∈ admins 表 ∪ env 白名单 */
async function adminSession(
  req: Request,
  config: AdminDeps['config'],
): Promise<{ sub: string } | { error: 401 | 403 }> {
  const session = await resolveTenantFromRequest(req, config.sessionSecret);
  if (!session) return { error: 401 };
  if (config.adminSubs.includes(session.sub)) return { sub: session.sub };
  const db = await getDb(config.dataDir);
  const row = await db.select().from(admins).where(eq(admins.sub, session.sub)).get();
  if (!row) return { error: 403 };
  return { sub: session.sub };
}

/** 读租户 state.json 的游荡/推送统计（缺失 = 0；损坏 = 显式抛，不吞） */
async function readTenantStats(dataDir: string, tenantId: string): Promise<{
  totalWanders: number;
  totalPushes: number;
}> {
  try {
    const content = await readFile(join(tenantDataDir(dataDir, tenantId), 'state.json'), 'utf-8');
    const parsed = JSON.parse(content) as { totalWanders?: unknown; totalPushes?: unknown };
    return {
      totalWanders: typeof parsed.totalWanders === 'number' ? parsed.totalWanders : 0,
      totalPushes: typeof parsed.totalPushes === 'number' ? parsed.totalPushes : 0,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { totalWanders: 0, totalPushes: 0 };
    }
    throw error;
  }
}

/** usage 文件名日期（usage-YYYY-MM-DD.jsonl → 'YYYY-MM-DD'）；非法名 = null */
function usageFileDate(file: string): string | null {
  const m = /^usage-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(file);
  return m ? m[1]! : null;
}

/** 读租户 usage 行（时间范围 [from, to] 日期字符串；缺省全部；行内 timestamp 再筛） */
async function readTenantUsage(
  dataDir: string,
  tenantId: string,
  from?: string,
  to?: string,
): Promise<UsageRow[]> {
  const dir = join(tenantDataDir(dataDir, tenantId), 'usage');
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; // 租户未产生用量 = 合法空态
    throw error;
  }
  const rows: UsageRow[] = [];
  for (const file of files) {
    const date = usageFileDate(file);
    if (!date) continue;
    if (from && date < from) continue;
    if (to && date > to) continue;
    let content: string;
    try {
      content = await readFile(join(dir, file), 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; // 并发轮转可能消失
      throw error;
    }
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let row: UsageRow;
      try {
        row = JSON.parse(line) as UsageRow;
      } catch {
        continue; // 半行写入（崩溃残留）跳过，不拖垮聚合
      }
      if (!row.timestamp || typeof row.kind !== 'string') continue;
      const day = row.timestamp.slice(0, 10);
      if (from && day < from) continue;
      if (to && day > to) continue;
      rows.push(row);
    }
  }
  return rows;
}

/** 租户级用量聚合（单租户；无数据 = 0，不报错） */
function aggregateTenantUsage(rows: UsageRow[]): {
  llmTokens: number;
  imageCount: number;
  visionCount: number;
  cost: number;
  lastActive: string | null;
} {
  let llmTokens = 0;
  let imageCount = 0;
  let visionCount = 0;
  let cost = 0;
  let lastActive: string | null = null;
  for (const row of rows) {
    if (row.kind === 'llm') {
      llmTokens += (row.inputTokens ?? 0) + (row.outputTokens ?? 0);
    } else if (row.kind === 'image') {
      imageCount += row.images ?? 1;
    } else if (row.kind === 'vision_qc') {
      visionCount += row.images ?? 1;
    }
    cost += costOf(row);
    if (!lastActive || row.timestamp > lastActive) lastActive = row.timestamp;
  }
  return { llmTokens, imageCount, visionCount, cost, lastActive };
}

export function createAdminRoutes({ config }: AdminDeps): Hono {
  const app = new Hono();

  /** GET /api/admin/users — 全部用户（tenants 主表，含无宠物）+ 宠物摘要 + 统计 */
  app.get('/users', async (c) => {
    const auth = await adminSession(c.req.raw, config);
    if ('error' in auth) {
      return c.json(jsonError(auth.error === 401 ? '未登录' : '无权访问'), auth.error);
    }

    const db = await getDb(config.dataDir);
    const tenantRows = await db.select().from(tenants).all();
    const petRows = await db.select().from(pets).all();
    const rows = await Promise.all(
      tenantRows.map(async (t) => {
        const pet = petRows.find((p) => p.tenantId === t.id) ?? null;
        const stats = pet ? await readTenantStats(config.dataDir, t.id) : { totalWanders: 0, totalPushes: 0 };
        return {
          tenantId: t.id,
          tenantName: t.name,
          plan: t.plan,
          createdAt: t.createdAt,
          petId: pet?.id ?? null,
          petName: pet?.name ?? null,
          petStatus: pet?.status ?? null,
          petBoredom: pet?.boredom ?? null,
          petEnergy: pet?.energy ?? null,
          petLastRunAt: pet?.lastRunAt ?? null,
          totalWanders: stats.totalWanders,
          totalPushes: stats.totalPushes,
        };
      }),
    );
    return c.json({ success: true, data: rows });
  });

  /** PUT /api/admin/users/:tenantId/plan — 改用户套餐（账号层） */
  app.put('/users/:tenantId/plan', async (c) => {
    const auth = await adminSession(c.req.raw, config);
    if ('error' in auth) {
      return c.json(jsonError(auth.error === 401 ? '未登录' : '无权访问'), auth.error);
    }
    const tenantId = c.req.param('tenantId');
    if (!TENANT_ID_RE.test(tenantId)) return c.json(jsonError('非法租户 id'), 400);

    let body: { plan?: unknown };
    try {
      body = (await c.req.json()) as { plan?: unknown };
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    if (typeof body.plan !== 'string' || !PLAN_VALUES.includes(body.plan as PlanValue)) {
      return c.json(jsonError(`plan 须为 ${PLAN_VALUES.join('|')}`), 400);
    }

    const db = await getDb(config.dataDir);
    const tenant = await db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
    if (!tenant) return c.json(jsonError('用户不存在'), 404);

    await db.update(tenants).set({ plan: body.plan as PlanValue }).where(eq(tenants.id, tenantId)).run();
    return c.json({ success: true, data: { tenantId, plan: body.plan } });
  });

  /** PUT /api/admin/users/:tenantId/pet-status — 暂停/恢复宠物（停用可关自进化） */
  app.put('/users/:tenantId/pet-status', async (c) => {
    const auth = await adminSession(c.req.raw, config);
    if ('error' in auth) {
      return c.json(jsonError(auth.error === 401 ? '未登录' : '无权访问'), auth.error);
    }
    const tenantId = c.req.param('tenantId');
    if (!TENANT_ID_RE.test(tenantId)) return c.json(jsonError('非法租户 id'), 400);

    let body: { status?: unknown };
    try {
      body = (await c.req.json()) as { status?: unknown };
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    if (body.status !== 'active' && body.status !== 'paused') {
      return c.json(jsonError('status 须为 active|paused'), 400);
    }

    const db = await getDb(config.dataDir);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, tenantId)).get();
    if (!pet) return c.json(jsonError('该用户无宠物'), 404);

    await db.update(pets).set({ status: body.status }).where(eq(pets.tenantId, tenantId)).run();
    return c.json({ success: true, data: { tenantId, status: body.status } });
  });

  /** GET /api/admin/admins — 管理员列表（env bootstrap + admins 表） */
  app.get('/admins', async (c) => {
    const auth = await adminSession(c.req.raw, config);
    if ('error' in auth) {
      return c.json(jsonError(auth.error === 401 ? '未登录' : '无权访问'), auth.error);
    }
    const db = await getDb(config.dataDir);
    const rows = await db.select().from(admins).all();
    const list = rows.map((r) => ({ sub: r.sub, grantedBy: r.grantedBy, createdAt: r.createdAt }));
    // env bootstrap 的管理员也展示（来源标注 env）
    for (const sub of config.adminSubs) {
      if (!list.some((a) => a.sub === sub)) list.push({ sub, grantedBy: 'env', createdAt: 0 });
    }
    return c.json({ success: true, data: list });
  });

  /** POST /api/admin/admins — 授予管理员（管理员可授权他人） */
  app.post('/admins', async (c) => {
    const auth = await adminSession(c.req.raw, config);
    if ('error' in auth) {
      return c.json(jsonError(auth.error === 401 ? '未登录' : '无权访问'), auth.error);
    }
    let body: { sub?: unknown };
    try {
      body = (await c.req.json()) as { sub?: unknown };
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    if (typeof body.sub !== 'string' || !TENANT_ID_RE.test(body.sub)) {
      return c.json(jsonError('sub 必填且为合法标识'), 400);
    }
    const db = await getDb(config.dataDir);
    await db
      .insert(admins)
      .values({ sub: body.sub, grantedBy: auth.sub })
      .onConflictDoNothing({ target: admins.sub })
      .run();
    return c.json({ success: true, data: { sub: body.sub, grantedBy: auth.sub } });
  });

  /** DELETE /api/admin/admins/:sub — 撤销管理员（禁自撤 + 保留至少一名） */
  app.delete('/admins/:sub', async (c) => {
    const auth = await adminSession(c.req.raw, config);
    if ('error' in auth) {
      return c.json(jsonError(auth.error === 401 ? '未登录' : '无权访问'), auth.error);
    }
    const sub = c.req.param('sub');
    if (!TENANT_ID_RE.test(sub)) return c.json(jsonError('非法 sub'), 400);
    if (sub === auth.sub) {
      return c.json(jsonError('不能撤销自己（会锁死管理面）'), 400);
    }
    const db = await getDb(config.dataDir);
    // 末位管理员保护：若本次撤销后表内为空且 env 白名单为空 → 拒绝（管理面不可锁死）
    const remaining = await db.select().from(admins).all();
    const isLast = remaining.length <= 1;
    if (isLast && config.adminSubs.length === 0) {
      return c.json(jsonError('至少保留一名管理员'), 400);
    }
    const removed = await db.delete(admins).where(eq(admins.sub, sub)).run();
    return c.json({ success: true, data: { removed: removed.rowsAffected > 0 } });
  });

  /**
   * GET /api/admin/usage?from=YYYY-MM-DD&to=YYYY-MM-DD — 用量成本可视化（ADR-0007）
   *
   * 响应：summary（总费用/token/张数）+ perTenant（每租户聚合）+ recent（最近 50 条明细）。
   * 费用按内置默认单价表折算（pricing.ts）；未知模型 0（不瞎估）。
   */
  app.get('/usage', async (c) => {
    const auth = await adminSession(c.req.raw, config);
    if ('error' in auth) {
      return c.json(jsonError(auth.error === 401 ? '未登录' : '无权访问'), auth.error);
    }
    const from = c.req.query('from');
    const to = c.req.query('to');
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if ((from && !dateRe.test(from)) || (to && !dateRe.test(to))) {
      return c.json(jsonError('from/to 须为 YYYY-MM-DD'), 400);
    }

    const db = await getDb(config.dataDir);
    const tenantRows = await db.select().from(tenants).all();
    const perTenant = await Promise.all(
      tenantRows.map(async (t) => {
        const rows = await readTenantUsage(config.dataDir, t.id, from, to);
        const agg = aggregateTenantUsage(rows);
        return {
          tenantId: t.id,
          tenantName: t.name,
          plan: t.plan,
          ...agg,
        };
      }),
    );

    const allRows = (await Promise.all(
      tenantRows.map((t) => readTenantUsage(config.dataDir, t.id, from, to)),
    )).flat();
    const summary = {
      totalCost: perTenant.reduce((s, p) => s + p.cost, 0),
      totalLlmTokens: perTenant.reduce((s, p) => s + p.llmTokens, 0),
      totalImages: perTenant.reduce((s, p) => s + p.imageCount, 0),
      totalVisionQc: perTenant.reduce((s, p) => s + p.visionCount, 0),
    };
    const recent = allRows
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      .slice(0, 50)
      .map((row) => ({ ...row, cost: costOf(row) }));

    return c.json({ success: true, data: { summary, perTenant, recent } });
  });

  return app;
}
