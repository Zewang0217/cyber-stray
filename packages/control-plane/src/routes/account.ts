/**
 * 账户路由 — /api/account（自助注销）
 *
 * DELETE /api/account：输入宠物名确认（未领养 = 「注销」二字），成功即软删
 * + 清 session cookie。语义与触点见 services/account-deletion-service.ts。
 */

import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import type { ControlPlaneConfig } from '../config.js';
import { requireTenant, type TenantEnv } from '../auth/require-tenant.js';
import { SESSION_COOKIE } from '../auth/session.js';
import { createAccountDeletionService } from '../services/account-deletion-service.js';

export interface AccountDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret' | 'adminSubs'>;
}

const jsonError = (message: string) => ({ success: false, error: message });

export function createAccountRoutes({ config }: AccountDeps): Hono<TenantEnv> {
  const app = new Hono<TenantEnv>();
  app.use('*', requireTenant(config));
  const service = createAccountDeletionService({ config });

  app.delete('/', async (c) => {
    let body: { confirmPetName?: unknown; reason?: unknown };
    try {
      body = (await c.req.json()) as { confirmPetName?: unknown; reason?: unknown };
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    if (typeof body.confirmPetName !== 'string' || !body.confirmPetName.trim()) {
      return c.json(jsonError('confirmPetName 须为非空字符串'), 400);
    }
    if (body.reason !== undefined && typeof body.reason !== 'string') {
      return c.json(jsonError('reason 须为字符串'), 400);
    }
    const outcome = await service.deleteSelf({
      tenantId: c.get('tenantId'),
      sub: c.get('userSub'),
      confirmPetName: body.confirmPetName.trim(),
      reason: body.reason,
    });
    if (!outcome.ok) return c.json(jsonError(outcome.error), outcome.status);
    // 注销即离场：与 logout 同口清 cookie（session 无服务端撤销，软删后
    // requireTenant 已拒绝，残留 cookie 至多 7 天无害）
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ success: true, data: outcome.data });
  });

  return app;
}
