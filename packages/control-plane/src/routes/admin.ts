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
import { readFile } from 'fs/promises';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { admins, pets, tenants } from '../db/schema.js';
import { tenantDataDir } from '../tenant.js';
import { PLAN_VALUES, type PlanValue } from '../plan/limits.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';
import { resolveTenantFromRequest } from '../request-tenant.js';

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

  return app;
}
