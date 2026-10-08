/**
 * 租户鉴权中间件
 *
 * session → user_tenants 关系行 → tenants 行（软删拒绝）→ TENANT_ID_RE；
 * 通过后 `c.set('tenantId')`。替代各 route 复制的 scopedTenantId/scopedTenant
 * （13 处复制收敛为单一实现）。401/403 响应形状与既有实现一致
 * （{success:false, error}）。
 *
 * 特例：需要「他人租户 404」语义的资源型路由（pet-assets）不适用本中间件，
 * 在路由内自行校验（防泄露存在性）。
 */

import type { Context, Next } from 'hono';
import type { ControlPlaneConfig } from '../config.js';
import { findTenantById, findUserTenantRelation } from '../infra/tenant-access.js';
import { noteTenantActivity } from '../infra/tenant-activity.js';
import { resolveTenantFromRequest } from './request-tenant.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';

export type TenantEnv = { Variables: { tenantId: string; userSub: string } };

export function requireTenant(config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>) {
  return async (c: Context<TenantEnv>, next: Next): Promise<Response | void> => {
    const session = await resolveTenantFromRequest(c.req.raw, config.sessionSecret);
    if (!session) return c.json({ success: false, error: '未登录' }, 401);

    const relation = await findUserTenantRelation(config.dataDir, session.sub, session.tenantId);
    if (!relation) return c.json({ success: false, error: '无权访问该租户' }, 403);
    // 软删账号：关系行保留作审计，但一切 API 访问到此为止
    const tenant = await findTenantById(config.dataDir, session.tenantId);
    if (!tenant) return c.json({ success: false, error: '无权访问该租户' }, 403);
    if (tenant.deletedAt !== null) return c.json({ success: false, error: '账号已注销' }, 403);
    if (!TENANT_ID_RE.test(session.tenantId)) {
      return c.json({ success: false, error: '无权访问该租户' }, 403);
    }

    c.set('tenantId', session.tenantId);
    c.set('userSub', session.sub);
    // X1「回访」信号（#272）：每个鉴权请求记一行活跃，no-throw 不影响业务
    noteTenantActivity(config.dataDir, session.tenantId);
    await next();
  };
}
