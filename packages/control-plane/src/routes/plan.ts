/**
 * plan 路由 — /api/plan*（接口层）
 *
 * 套餐门控的用户面：查套餐/限额、切换套餐（admin-only——自助切换是白嫖
 * 平台配额的口子，RBAC 复用 adminSession）、Pro 自定义推送时间窗、BYOK
 * 自带 DeepSeek key（信封加密，对所有套餐开放，绑 key 不变更套餐）。
 *
 * 租户隔离走 requireTenant 中间件；用例在 services/plan-service；
 * 计费（Stripe）后续接入后在支付链路收口。
 */

import { Hono } from 'hono';
import { PLAN_VALUES, type PlanValue } from '../plan/limits.js';
import type { ControlPlaneConfig } from '../config.js';
import { adminSession } from './admin.js';
import { requireTenant, type TenantEnv } from '../auth/require-tenant.js';
import { createPlanService } from '../services/plan-service.js';

export interface PlanDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret' | 'adminSubs'>;
}

const jsonError = (message: string) => ({ success: false, error: message });

/** 有效小时（0-23 整数） */
function validHour(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23;
}

export function createPlanRoutes({ config }: PlanDeps): Hono<TenantEnv> {
  const service = createPlanService({ config });
  const app = new Hono<TenantEnv>();

  app.use('*', requireTenant(config));

  /** GET /api/plan — 套餐 + 限额 + 窗口 + BYOK 状态（不回显 key） */
  app.get('/', async (c) => {
    const outcome = await service.getPlan(c.get('tenantId'));
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json(jsonError(outcome.error), outcome.status);
  });

  /** PUT /api/plan — 切换套餐（admin-only；租户隔离仍先校验） */
  app.put('/', async (c) => {
    const scoped = c.get('tenantId');
    const auth = await adminSession(c.req.raw, config);
    if ('error' in auth) {
      return c.json(jsonError(auth.error === 401 ? '未登录' : '仅管理员可变更套餐'), auth.error);
    }

    let body: { plan?: unknown };
    try {
      body = (await c.req.json()) as { plan?: unknown };
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    const nextPlan = body.plan;
    if (typeof nextPlan !== 'string' || !PLAN_VALUES.includes(nextPlan as PlanValue)) {
      return c.json(jsonError(`plan 须为 ${PLAN_VALUES.join('|')}`), 400);
    }

    const outcome = await service.changePlan(scoped, nextPlan as PlanValue);
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json(jsonError(outcome.error), outcome.status);
  });

  /** PUT /api/plan/push-window — Pro/BYOK 自定义推送时间窗（本地小时） */
  app.put('/push-window', async (c) => {
    let body: { startHour?: unknown; endHour?: unknown };
    try {
      body = (await c.req.json()) as { startHour?: unknown; endHour?: unknown };
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    if (!validHour(body.startHour) || !validHour(body.endHour)) {
      return c.json(jsonError('startHour/endHour 须为 0-23 整数'), 400);
    }
    if (body.startHour === body.endHour) {
      return c.json(jsonError('startHour 不能等于 endHour（空窗口）'), 400);
    }

    const outcome = await service.setPushWindow(c.get('tenantId'), body.startHour, body.endHour);
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json(jsonError(outcome.error), outcome.status);
  });

  /** DELETE /api/plan/push-window — 清窗口（回全天） */
  app.delete('/push-window', async (c) => {
    const outcome = await service.clearPushWindow(c.get('tenantId'));
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json(jsonError(outcome.error), outcome.status);
  });

  /** PUT /api/plan/byok-key — BYOK 自带 DeepSeek key 对所有套餐开放 */
  app.put('/byok-key', async (c) => {
    let body: { apiKey?: unknown };
    try {
      body = (await c.req.json()) as { apiKey?: unknown };
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    if (typeof body.apiKey !== 'string' || !body.apiKey.trim()) {
      return c.json(jsonError('apiKey 必填'), 400);
    }

    const outcome = await service.bindByokKey(c.get('tenantId'), body.apiKey.trim());
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json(jsonError(outcome.error), outcome.status);
  });

  /** DELETE /api/plan/byok-key — 移除 key */
  app.delete('/byok-key', async (c) => {
    return c.json({ success: true, data: await service.unbindByokKey(c.get('tenantId')) });
  });

  return app;
}
