/**
 * 微信通道路由 — /api/wechat*（#97）
 *
 * - POST /bind/start（公开，扫码即用入口）：发起绑定 → 返回二维码 URL +
 *   会话 id；可选 tenantId 用于已有租户重新激活（pairing 白名单校验防
 *   他人扫码抢绑）。无 Casdoor 会话——微信身份即租户锚点。
 * - GET /bind/status（公开）：前端轮询绑定状态（wait/scaned/confirmed/
 *   expired/error），confirmed 带 result（tenantId/petName）。
 * - GET /status（登录态）：当前租户微信通道状态（bound/active/expired +
 *   过期提示），供设置页展示。
 *
 * 会话令牌 = 一次性 UUID（不可枚举）；并发绑定会话数由内存会话表控制，
 * 到期自动清理。公开端点的加固（限流/验证码）见"部署后验证项"。
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { userTenants } from '../db/schema.js';
import { getBinding } from '../ilink/bindings.js';
import type { BindingService } from '../ilink/binding-service.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';
import { resolveTenantFromRequest } from '../request-tenant.js';
import { logger } from '../logger.js';

export interface WechatRoutesDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
  /** 绑定状态机（测试注入 fake client 的服务） */
  bindings: BindingService;
}

const jsonError = (message: string) => ({ success: false, error: message });

/** 登录态租户校验（同 channels/pets 规矩） */
async function scopedTenantId(
  req: Request,
  config: WechatRoutesDeps['config'],
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

export function createWechatRoutes({ config, bindings }: WechatRoutesDeps): Hono {
  const app = new Hono();

  /** POST /bind/start — 公开：发起扫码绑定 */
  app.post('/bind/start', async (c) => {
    let body: { tenantId?: unknown };
    try {
      body = (await c.req.json()) as { tenantId?: unknown };
    } catch {
      body = {};
    }
    const tenantId = body.tenantId;
    if (tenantId !== undefined && (typeof tenantId !== 'string' || !TENANT_ID_RE.test(tenantId))) {
      return c.json(jsonError('tenantId 非法'), 400);
    }

    // 公开端点限流键：反代透传的客户端 IP（缺省 'unknown' 全局兜底）
    const clientKey = c.req.raw.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    try {
      const result = await bindings.start(tenantId as string | undefined, clientKey);
      return c.json({ success: true, data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // #116：公开端点的失败必须可追查——clientKey（来源 IP）是唯一归属线索
      logger.error('绑定发起失败', {
        clientKey,
        endpoint: 'get_bot_qrcode',
        tenantId: tenantId ?? null,
        error: message,
        stack: error instanceof Error ? error.stack : undefined,
      });
      if (message.includes('过于频繁') || message.includes('会话过多')) {
        return c.json(jsonError(message), 429);
      }
      return c.json(jsonError(`获取二维码失败: ${message}`), 502);
    }
  });

  /** GET /bind/status?session=<id> — 公开：轮询绑定状态 */
  app.get('/bind/status', async (c) => {
    const session = c.req.query('session');
    if (!session || !/^[a-zA-Z0-9-]{1,64}$/.test(session)) {
      return c.json(jsonError('session 必填'), 400);
    }
    const status = bindings.getStatus(session);
    return c.json({ success: true, data: status });
  });

  /** GET /status — 登录态：当前租户微信通道状态（设置页/过期提示） */
  app.get('/status', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const db = await getDb(config.dataDir);
    const binding = await getBinding(db, scoped.tenantId);
    if (!binding) {
      return c.json({ success: true, data: { bound: false } });
    }
    return c.json({
      success: true,
      data: {
        bound: true,
        status: binding.status,
        tenantId: scoped.tenantId,
        ...(binding.status === 'expired'
          ? { expiredHint: '微信通道已过期,发条消息重新激活' }
          : {}),
      },
    });
  });

  return app;
}
