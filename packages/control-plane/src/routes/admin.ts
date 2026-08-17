/**
 * admin 路由 — /api/admin*（S13 运营管理面板）
 *
 * 管理员的用户/宠物总览与额度分配。管理员判定：session.sub ∈ 配置的
 * CP_ADMIN_SUBS 白名单（env 逗号分隔）——不依赖 user_tenants 关系，
 * 管理员无需是租户成员。
 *
 * 安全：admin 是提升权限面——请求仍走 session JWT 验证（不可伪造）；
 * 管理员的 sub 白名单在控制面 env（运维配置，不暴露给前端）。
 */

import { Hono } from 'hono';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { pets, tenants } from '../db/schema.js';
import { tenantDataDir } from '../tenant.js';
import { PLAN_VALUES, type PlanValue } from '../plan/limits.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';
import { resolveTenantFromRequest } from '../request-tenant.js';

export interface AdminDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret' | 'adminSubs'>;
}

const jsonError = (message: string) => ({ success: false, error: message });

/** 管理员判定：session 有效且 sub 在白名单（不查租户关系） */
async function adminSession(
  req: Request,
  config: AdminDeps['config'],
): Promise<{ sub: string } | { error: 401 | 403 }> {
  const session = await resolveTenantFromRequest(req, config.sessionSecret);
  if (!session) return { error: 401 };
  if (!config.adminSubs.includes(session.sub)) return { error: 403 };
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

  /** GET /api/admin/tenants — 全部租户宠物总览（含 state 统计） */
  app.get('/tenants', async (c) => {
    const auth = await adminSession(c.req.raw, config);
    if ('error' in auth) {
      return c.json(jsonError(auth.error === 401 ? '未登录' : '无权访问'), auth.error);
    }

    const db = await getDb(config.dataDir);
    const petsRows = await db.select().from(pets).all();
    const tenantRows = await db.select().from(tenants).all();
    const rows = await Promise.all(
      petsRows.map(async (pet) => {
        const tenant = tenantRows.find((t) => t.id === pet.tenantId);
        const stats = await readTenantStats(config.dataDir, pet.tenantId);
        return {
          tenantId: pet.tenantId,
          tenantName: tenant?.name ?? pet.tenantId,
          petId: pet.id,
          petName: pet.name,
          plan: pet.plan,
          status: pet.status,
          boredom: pet.boredom,
          energy: pet.energy,
          lastRunAt: pet.lastRunAt,
          totalWanders: stats.totalWanders,
          totalPushes: stats.totalPushes,
        };
      }),
    );
    return c.json({ success: true, data: rows });
  });

  /** PUT /api/admin/tenants/:tenantId/plan — 分配套餐（额度） */
  app.put('/tenants/:tenantId/plan', async (c) => {
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
    const pet = await db.select().from(pets).where(eq(pets.tenantId, tenantId)).get();
    if (!pet) return c.json(jsonError('该租户无宠物'), 404);

    await db.update(pets).set({ plan: body.plan as PlanValue }).where(eq(pets.tenantId, tenantId)).run();
    return c.json({ success: true, data: { tenantId, plan: body.plan } });
  });

  /** PUT /api/admin/tenants/:tenantId/status — 暂停/恢复宠物（停用可关自进化） */
  app.put('/tenants/:tenantId/status', async (c) => {
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
    if (!pet) return c.json(jsonError('该租户无宠物'), 404);

    await db.update(pets).set({ status: body.status }).where(eq(pets.tenantId, tenantId)).run();
    return c.json({ success: true, data: { tenantId, status: body.status } });
  });

  return app;
}
