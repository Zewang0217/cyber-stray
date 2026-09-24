/**
 * admin 路由 — /api/admin*（接口层）
 *
 * 管理员判定（RBAC）：session.sub ∈ admins 表 ∪ CP_ADMIN_SUBS env 白名单。
 * 身份在 Casdoor（谁可登录），权限在控制面（能做什么）——admin 是「看全部
 * 租户数据」的资源权限，放 Casdoor 会与身份耦合，故在控制面 DB 管理；
 * env 白名单作 bootstrap（首启引导），入表后可移除。
 *
 * 用户级管理：套餐在账号层（tenants.plan，非 pets.plan）；GET /users 列出
 * 全部用户（含无宠物），PUT plan 改账号套餐。用例编排在
 * services/admin-service，admins 表在 infra/admin-repo；本文件只做鉴权、
 * 参数校验与 HTTP 映射。
 */

import { Hono } from 'hono';
import type { ControlPlaneConfig } from '../config.js';
import { validateModelId } from '../infra/app-config.js';
import { findAdminBySub } from '../infra/admin-repo.js';
import { PLAN_VALUES, type PlanValue } from '../plan/limits.js';
import { resolveTenantFromRequest } from '../auth/request-tenant.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';
import { createAdminService } from '../services/admin-service.js';

export interface AdminDeps {
  config: Pick<
    ControlPlaneConfig,
    | 'dataDir'
    | 'sessionSecret'
    | 'adminSubs'
    | 'arkImageModel'
    | 'visionModel'
    | 'webOrigin'
    | 'llmBudgetEnabled'
    | 'llmBudgetYuan'
  >;
}

const jsonError = (message: string) => ({ success: false, error: message });

/** 管理员判定：session 有效且 sub ∈ admins 表 ∪ env 白名单 */
export async function adminSession(
  req: Request,
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret' | 'adminSubs'>,
): Promise<{ sub: string } | { error: 401 | 403 }> {
  const session = await resolveTenantFromRequest(req, config.sessionSecret);
  if (!session) return { error: 401 };
  if (config.adminSubs.includes(session.sub)) return { sub: session.sub };
  const row = await findAdminBySub(config.dataDir, session.sub);
  if (!row) return { error: 403 };
  return { sub: session.sub };
}

export function createAdminRoutes({ config }: AdminDeps): Hono {
  const service = createAdminService({ config });
  const app = new Hono();

  /** GET /api/admin/users — 全部用户（tenants 主表，含无宠物）+ 宠物摘要 + 统计 */
  app.get('/users', async (c) => {
    const auth = await adminSession(c.req.raw, config);
    if ('error' in auth) {
      return c.json(jsonError(auth.error === 401 ? '未登录' : '无权访问'), auth.error);
    }
    return c.json({ success: true, data: await service.listUsers() });
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

    const outcome = await service.updatePlan(tenantId, body.plan as PlanValue);
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json(jsonError(outcome.error), outcome.status);
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

    const outcome = await service.setPetStatus(tenantId, body.status);
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json(jsonError(outcome.error), outcome.status);
  });

  /** GET /api/admin/admins — 管理员列表（env bootstrap + admins 表） */
  app.get('/admins', async (c) => {
    const auth = await adminSession(c.req.raw, config);
    if ('error' in auth) {
      return c.json(jsonError(auth.error === 401 ? '未登录' : '无权访问'), auth.error);
    }
    return c.json({ success: true, data: await service.listAdmins() });
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
    return c.json({ success: true, data: await service.grantAdmin(body.sub, auth.sub) });
  });

  /** DELETE /api/admin/admins/:sub — 撤销管理员（禁自撤 + 保留至少一名） */
  app.delete('/admins/:sub', async (c) => {
    const auth = await adminSession(c.req.raw, config);
    if ('error' in auth) {
      return c.json(jsonError(auth.error === 401 ? '未登录' : '无权访问'), auth.error);
    }
    const sub = c.req.param('sub');
    if (!TENANT_ID_RE.test(sub)) return c.json(jsonError('非法 sub'), 400);

    const outcome = await service.revokeAdmin(sub, auth.sub);
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json(jsonError(outcome.error), outcome.status);
  });

  /**
   * GET /api/admin/usage?from=YYYY-MM-DD&to=YYYY-MM-DD — 用量成本可视化
   *
   * 响应：summary（总费用/token/张数）+ perTenant（每租户聚合，附今日 LLM
   * 水位：llmCostToday + llmBudgetYuan，null = 未启用/不限）+ recent（最近
   * 50 条明细）。费用按内置默认单价表折算，未知模型 0（不瞎估）。
   */
  /** GET /api/admin/invites — 邀请列表（脱敏） */
  app.get('/invites', async (c) => {
    const auth = await adminSession(c.req.raw, config);
    if ('error' in auth) {
      return c.json(jsonError(auth.error === 401 ? '未登录' : '无权访问'), auth.error);
    }
    return c.json({ success: true, data: await service.listInvites() });
  });

  /** POST /api/admin/invites — 生成邀请（raw token/链接仅本次响应返回） */
  app.post('/invites', async (c) => {
    const auth = await adminSession(c.req.raw, config);
    if ('error' in auth) {
      return c.json(jsonError(auth.error === 401 ? '未登录' : '无权访问'), auth.error);
    }
    let body: { label?: unknown } = {};
    try {
      body = (await c.req.json()) as { label?: unknown };
    } catch {
      // 空请求体合法（label 可省）；非 JSON 视为无 label
    }
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 64) : undefined;
    return c.json({ success: true, data: await service.createInvite({ createdBy: auth.sub, label }) });
  });

  /** DELETE /api/admin/invites/:id — 吊销邀请（已消费/已吊销 → 404） */
  app.delete('/invites/:id', async (c) => {
    const auth = await adminSession(c.req.raw, config);
    if ('error' in auth) {
      return c.json(jsonError(auth.error === 401 ? '未登录' : '无权访问'), auth.error);
    }
    const outcome = await service.revokeInvite(c.req.param('id'));
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json(jsonError(outcome.error), outcome.status);
  });

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
    return c.json({ success: true, data: await service.usageReport(from, to) });
  });

  /** GET /api/admin/config — 全局模型配置：当前生效值 + 候选下拉 */
  app.get('/config', async (c) => {
    const auth = await adminSession(c.req.raw, config);
    if ('error' in auth) {
      return c.json(jsonError(auth.error === 401 ? '未登录' : '无权访问'), auth.error);
    }
    return c.json({ success: true, data: service.getModelSettings() });
  });

  /** PUT /api/admin/config — 更新全局模型（缺省字段保持不变），下次生图生效 */
  app.put('/config', async (c) => {
    const auth = await adminSession(c.req.raw, config);
    if ('error' in auth) {
      return c.json(jsonError(auth.error === 401 ? '未登录' : '无权访问'), auth.error);
    }
    let body: { imageModel?: unknown; visionModel?: unknown };
    try {
      body = (await c.req.json()) as { imageModel?: unknown; visionModel?: unknown };
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    if (body.imageModel !== undefined) {
      const err = validateModelId(body.imageModel);
      if (err) return c.json(jsonError(`imageModel: ${err}`), 400);
    }
    if (body.visionModel !== undefined) {
      const err = validateModelId(body.visionModel);
      if (err) return c.json(jsonError(`visionModel: ${err}`), 400);
    }

    const saved = await service.updateModelSettings({
      imageModel: typeof body.imageModel === 'string' ? body.imageModel : undefined,
      visionModel: typeof body.visionModel === 'string' ? body.visionModel : undefined,
    });
    return c.json({ success: true, data: saved });
  });

  return app;
}
