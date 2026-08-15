/**
 * push 路由 — /api/push/*（S10，#77）
 *
 * Web Push 订阅管理：
 * - GET  /api/push/vapid-key   公开：浏览器订阅前需要应用服务器公钥
 * - POST /api/push/subscribe   登录：登记/刷新订阅（endpoint 幂等，
 *                              换租户重新订阅即转移归属——设备跟人走）
 * - DELETE /api/push/subscribe 登录：按 endpoint 退订（只能删本租户的）
 *
 * 租户只由 session claim 决定（x-tenant-* header 一律忽略）。
 */

import { Hono } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import webpush from 'web-push';
import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { pushSubscriptions, vapidKeys, userTenants } from '../db/schema.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';
import { resolveTenantFromRequest } from '../request-tenant.js';

export interface PushDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
}

const jsonError = (message: string) => ({ success: false, error: message });

/** VAPID 单例行 id（首用时生成整对，跨重启稳定） */
const VAPID_ROW_ID = 1;

/**
 * 取（或生成）VAPID 密钥对。
 * env 显式提供时优先（运维可预生成/轮换）；否则首用时生成存 DB 单例行。
 */
export async function getVapidKeys(
  dataDir: string,
): Promise<{ publicKey: string; privateKey: string }> {
  const db = await getDb(dataDir);

  const envPub = process.env.CP_VAPID_PUBLIC_KEY;
  const envPriv = process.env.CP_VAPID_PRIVATE_KEY;
  if (envPub && envPriv) {
    return { publicKey: envPub, privateKey: envPriv };
  }

  const existing = await db.select().from(vapidKeys).where(eq(vapidKeys.id, VAPID_ROW_ID)).get();
  if (existing) {
    return { publicKey: existing.publicKey, privateKey: existing.privateKey };
  }

  const generated = webpush.generateVAPIDKeys();
  await db
    .insert(vapidKeys)
    .values({
      id: VAPID_ROW_ID,
      publicKey: generated.publicKey,
      privateKey: generated.privateKey,
    })
    .onConflictDoNothing({ target: vapidKeys.id })
    .run();
  const row = await db.select().from(vapidKeys).where(eq(vapidKeys.id, VAPID_ROW_ID)).get();
  if (!row) {
    throw new Error('VAPID 密钥生成失败'); // 理论不可达：插入后必可读
  }
  return { publicKey: row.publicKey, privateKey: row.privateKey };
}

/** 鉴权 + 租户校验：401 / 403 / { tenantId }（与 pets.ts 同规矩） */
async function scopedTenantId(
  req: Request,
  config: PushDeps['config'],
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

/** 订阅体（结构与浏览器 PushSubscription.toJSON() 对齐） */
interface SubscribeBody {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

/** 校验订阅体；返回规范化字段或错误消息 */
function parseSubscribeBody(
  body: SubscribeBody,
): { endpoint: string; p256dh: string; auth: string } | { invalid: string } {
  const endpoint = body.endpoint;
  const keys = body.keys;
  if (typeof endpoint !== 'string' || !/^https?:\/\//.test(endpoint)) {
    return { invalid: 'endpoint 须为合法 URL' };
  }
  if (
    !keys ||
    typeof keys.p256dh !== 'string' ||
    !keys.p256dh ||
    typeof keys.auth !== 'string' ||
    !keys.auth
  ) {
    return { invalid: 'keys.p256dh 与 keys.auth 必填' };
  }
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

export function createPushRoutes({ config }: PushDeps): Hono {
  const app = new Hono();

  /** GET /api/push/vapid-key — 公开（浏览器订阅前拉取；无泄漏风险） */
  app.get('/vapid-key', async (c) => {
    const keys = await getVapidKeys(config.dataDir);
    return c.json({ success: true, data: { publicKey: keys.publicKey } });
  });

  /** POST /api/push/subscribe — 登记订阅（endpoint 幂等） */
  app.post('/subscribe', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }

    let body: SubscribeBody;
    try {
      body = (await c.req.json()) as SubscribeBody;
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    const parsed = parseSubscribeBody(body);
    if ('invalid' in parsed) {
      return c.json(jsonError(parsed.invalid), 400);
    }

    const db = await getDb(config.dataDir);
    const now = Date.now();
    // 单语句 upsert（SELECT-then-INSERT 并发双击会撞唯一约束 500）。
    // lastNotifiedAt 语义：新订阅/换租户重置为 now——只通知订阅后的新内容，
    // 首次事件不追发历史；同租户续订保留（不因浏览器刷新重复收旧内容）。
    // 注：endpoint 是 Web Push 的 capability URL（高熵机密），归属转移
    // 即"设备换号"——持有 endpoint 即视为设备本人在操作（已接受的设计取舍）
    await db
      .insert(pushSubscriptions)
      .values({
        id: crypto.randomUUID(),
        tenantId: scoped.tenantId,
        endpoint: parsed.endpoint,
        p256dh: parsed.p256dh,
        auth: parsed.auth,
        lastNotifiedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          tenantId: scoped.tenantId,
          p256dh: parsed.p256dh,
          auth: parsed.auth,
          updatedAt: now,
          lastNotifiedAt: sql`CASE WHEN push_subscriptions.tenant_id = ${scoped.tenantId} THEN push_subscriptions.last_notified_at ELSE ${now} END`,
        },
      })
      .run();
    return c.json({ success: true, data: { upserted: true } }, 200);
  });

  /** DELETE /api/push/subscribe — 按 endpoint 退订（限本租户） */
  app.delete('/subscribe', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }

    let body: { endpoint?: unknown };
    try {
      body = (await c.req.json()) as { endpoint?: unknown };
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    if (typeof body.endpoint !== 'string' || !body.endpoint) {
      return c.json(jsonError('endpoint 必填'), 400);
    }

    const db = await getDb(config.dataDir);
    // 只删本租户的行：他租户的 endpoint 存在与否不可探测（404 统一）
    const deleted = await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, body.endpoint),
          eq(pushSubscriptions.tenantId, scoped.tenantId),
        ),
      )
      .run();
    if (deleted.rowsAffected === 0) {
      return c.json(jsonError('订阅不存在'), 404);
    }
    return c.json({ success: true, data: { deleted: true } });
  });

  return app;
}
