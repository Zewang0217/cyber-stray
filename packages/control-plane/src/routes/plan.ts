/**
 * plan 路由 — /api/plan*（S11，#78）
 *
 * 套餐门控的用户面：查套餐/限额、切换套餐（free/pro/byok）、Pro 自定义
 * 推送时间窗、BYOK 自带 DeepSeek key（S4 加密存储，worker-runner 注入
 * deepseek_api_key → AgentSecrets.deepseekApiKey，agent 侧 BYOK 挡 env 回退）。
 *
 * 计费（Stripe）后续接入后由 billing 表落账；当前切换无支付校验（自托管
 * 早期形态，计费落地时在此收口）。
 *
 * 租户只由 session claim 决定（x-tenant-* header 一律忽略）。
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { pets, userTenants } from '../db/schema.js';
import { planLimits, PLAN_VALUES, type PlanValue } from '../plan/limits.js';
import { openTenantSecrets, TENANT_ID_RE } from '../secrets/tenant-secrets.js';
import { resolveTenantFromRequest } from '../request-tenant.js';

export interface PlanDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
}

/** BYOK DeepSeek key 的 S4 存储名（worker-runner SECRET_FIELD_BY_NAME 同名约定） */
export const BYOK_KEY_SECRET = 'deepseek_api_key';

const jsonError = (message: string) => ({ success: false, error: message });

/** 有效小时（0-23 整数） */
function validHour(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23;
}

/** 鉴权 + 租户校验：401 / 403 / { tenantId }（与 pets.ts 同规矩） */
async function scopedTenantId(
  req: Request,
  config: PlanDeps['config'],
): Promise<{ tenantId: string } | { error: 401 | 403 }> {
  const session = await resolveTenantFromRequest(req, config.sessionSecret);
  if (!session) return { error: 401 };
  const db = await getDb(config.dataDir);
  const relation = await db
    .select()
    .from(userTenants)
    .where(
      and(eq(userTenants.userId, session.sub), eq(userTenants.tenantId, session.tenantId)),
    )
    .get();
  if (!relation) return { error: 403 };
  if (!TENANT_ID_RE.test(session.tenantId)) return { error: 403 };

  return { tenantId: session.tenantId };
}

export function createPlanRoutes({ config }: PlanDeps): Hono {
  const app = new Hono();

  /** GET /api/plan — 套餐 + 限额 + 窗口 + BYOK 状态（不回显 key） */
  app.get('/', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }

    const db = await getDb(config.dataDir);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, scoped.tenantId)).get();
    if (!pet) return c.json(jsonError('尚未领养宠物'), 409);

    const store = await openTenantSecrets(config.dataDir, scoped.tenantId);
    const names = await store.list();
    return c.json({
      success: true,
      data: {
        plan: pet.plan,
        limits: planLimits(pet.plan),
        pushWindow:
          pet.pushWindowStart !== null && pet.pushWindowEnd !== null
            ? { startHour: pet.pushWindowStart, endHour: pet.pushWindowEnd }
            : null,
        byok: { keyBound: names.includes(BYOK_KEY_SECRET) },
      },
    });
  });

  /** PUT /api/plan — 切换套餐 */
  app.put('/', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
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

    const db = await getDb(config.dataDir);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, scoped.tenantId)).get();
    if (!pet) return c.json(jsonError('尚未领养宠物'), 409);

    // 降级清窗口（自定义推送时间是 Pro 权益；BYOK 同 Pro 保留）
    const keepWindow = nextPlan !== 'free';
    await db
      .update(pets)
      .set({
        plan: nextPlan as PlanValue,
        ...(keepWindow ? {} : { pushWindowStart: null, pushWindowEnd: null }),
      })
      .where(eq(pets.tenantId, scoped.tenantId))
      .run();
    return c.json({ success: true, data: { plan: nextPlan } });
  });

  /** PUT /api/plan/push-window — Pro/BYOK 自定义推送时间窗（本地小时） */
  app.put('/push-window', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }

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

    const db = await getDb(config.dataDir);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, scoped.tenantId)).get();
    if (!pet) return c.json(jsonError('尚未领养宠物'), 409);
    if (pet.plan === 'free') {
      return c.json(jsonError('自定义推送时间是 Pro 权益'), 403);
    }

    await db
      .update(pets)
      .set({ pushWindowStart: body.startHour, pushWindowEnd: body.endHour })
      .where(eq(pets.tenantId, scoped.tenantId))
      .run();
    return c.json({ success: true, data: { startHour: body.startHour, endHour: body.endHour } });
  });

  /** DELETE /api/plan/push-window — 清窗口（回全天） */
  app.delete('/push-window', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const db = await getDb(config.dataDir);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, scoped.tenantId)).get();
    if (!pet) return c.json(jsonError('尚未领养宠物'), 409);

    await db
      .update(pets)
      .set({ pushWindowStart: null, pushWindowEnd: null })
      .where(eq(pets.tenantId, scoped.tenantId))
      .run();
    return c.json({ success: true, data: { cleared: true } });
  });

  /** PUT /api/plan/byok-key — BYOK 自带 DeepSeek key（S4 加密存储） */
  app.put('/byok-key', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }

    let body: { apiKey?: unknown };
    try {
      body = (await c.req.json()) as { apiKey?: unknown };
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    if (typeof body.apiKey !== 'string' || !body.apiKey.trim()) {
      return c.json(jsonError('apiKey 必填'), 400);
    }

    const db = await getDb(config.dataDir);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, scoped.tenantId)).get();
    if (!pet) return c.json(jsonError('尚未领养宠物'), 409);
    if (pet.plan !== 'byok') {
      return c.json(jsonError('BYOK key 仅 byok 套餐可配置'), 403);
    }

    const store = await openTenantSecrets(config.dataDir, scoped.tenantId);
    await store.set(BYOK_KEY_SECRET, body.apiKey.trim());
    return c.json({ success: true, data: { bound: true } });
  });

  /** DELETE /api/plan/byok-key — 移除 key */
  app.delete('/byok-key', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const store = await openTenantSecrets(config.dataDir, scoped.tenantId);
    const removed = await store.delete(BYOK_KEY_SECRET);
    return c.json({ success: true, data: { removed } });
  });

  return app;
}
