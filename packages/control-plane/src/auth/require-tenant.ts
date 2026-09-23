/**
 * 租户鉴权中间件
 *
 * session → user_tenants 关系行 → TENANT_ID_RE；通过后 `c.set('tenantId')`。
 * 替代各 route 复制的 scopedTenantId/scopedTenant（13 处复制收敛为单一实现）。
 * 401/403 响应形状与既有实现一致（{success:false, error}）。
 *
 * 特例：需要「他人租户 404」语义的资源型路由（pet-assets）不适用本中间件，
 * 在路由内自行校验（防泄露存在性）。
 */

import type { Context, Next } from 'hono';
import type { ControlPlaneConfig } from '../config.js';
import { findUserTenantRelation } from '../infra/tenant-access.js';
import { resolveTenantFromRequest } from './request-tenant.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';

export type TenantEnv = { Variables: { tenantId: string } };

export function requireTenant(config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>) {
  return async (c: Context<TenantEnv>, next: Next): Promise<Response | void> => {
    const session = await resolveTenantFromRequest(c.req.raw, config.sessionSecret);
    if (!session) return c.json({ success: false, error: '未登录' }, 401);

    const relation = await findUserTenantRelation(config.dataDir, session.sub, session.tenantId);
    if (!relation) return c.json({ success: false, error: '无权访问该租户' }, 403);
    if (!TENANT_ID_RE.test(session.tenantId)) {
      return c.json({ success: false, error: '无权访问该租户' }, 403);
    }

    c.set('tenantId', session.tenantId);
    await next();
  };
}
