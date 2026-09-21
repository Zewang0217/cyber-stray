/**
 * push 路由 — /api/push/*（接口层）
 *
 * Web Push 订阅管理：vapid-key 公开拉取；subscribe（endpoint 幂等，换租户
 * 重新订阅即转移归属——设备跟人走）；退订（限本租户）；首推送达状态。
 *
 * 租户隔离走 requireTenant 中间件（x-tenant-* 一律忽略）；订阅存储与
 * VAPID 密钥在 infra/push-repo，用例在 services/push-service。
 */

import { Hono } from 'hono';
import type { ControlPlaneConfig } from '../config.js';
import { requireTenant, type TenantEnv } from '../middleware/require-tenant.js';
import { createPushService } from '../services/push-service.js';

export interface PushDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
}

const jsonError = (message: string) => ({ success: false, error: message });

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

export function createPushRoutes({ config }: PushDeps): Hono<TenantEnv> {
  const service = createPushService({ config });
  const app = new Hono<TenantEnv>();

  /** GET /api/push/vapid-key — 公开（浏览器订阅前拉取；无泄漏风险） */
  app.get('/vapid-key', async (c) => {
    return c.json({ success: true, data: await service.getPublicKey() });
  });

  // 订阅类端点走租户校验；vapid-key 公开所以中间件只挂在其后注册的路由上
  app.use('/subscribe', requireTenant(config));
  app.use('/status', requireTenant(config));

  /** POST /api/push/subscribe — 登记订阅（endpoint 幂等） */
  app.post('/subscribe', async (c) => {
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
    return c.json({ success: true, data: await service.subscribe(c.get('tenantId'), parsed) }, 200);
  });

  /** DELETE /api/push/subscribe — 按 endpoint 退订（限本租户） */
  app.delete('/subscribe', async (c) => {
    let body: { endpoint?: unknown };
    try {
      body = (await c.req.json()) as { endpoint?: unknown };
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    if (typeof body.endpoint !== 'string' || !body.endpoint) {
      return c.json(jsonError('endpoint 必填'), 400);
    }
    const result = await service.unsubscribe(c.get('tenantId'), body.endpoint);
    return result
      ? c.json({ success: true, data: result })
      : c.json(jsonError('订阅不存在'), 404);
  });

  /**
   * GET /api/push/status — 首推送达标记（租户空态文案数据源）。
   * pendingDelivery：有订阅、存在可通知内容、且比所有设备的已通知位都新。
   */
  app.get('/status', async (c) => {
    return c.json({ success: true, data: await service.getStatus(c.get('tenantId')) });
  });

  return app;
}
