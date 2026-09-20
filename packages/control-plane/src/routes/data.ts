/**
 * data 路由 — /api/{state,interests,interests/history,history}（接口层）
 *
 * Web API 的租户化只读数据面：
 * - 鉴权：session cookie JWT（无/坏 → 401）；租户只由 session claim 决定
 *   （x-tenant-* header 一律忽略——安全硬规矩）
 * - 租户范围校验：claim 的 (sub, tenantId) 必须有 user_tenants 关系行（防
 *   过期/伪造 claim 越权），否则 403
 * - 只读契约：绝不写 agent 数据；文件读取在 infra/tenant-data-reader，
 *   展示归一化在 domain/history-view，熵公式单一真相源在 shared
 * - 响应 shape：{success, data|error}（/history 另带顶层 pagination）
 */

import { Hono } from 'hono';
import type { ControlPlaneConfig } from '../config.js';
import { findUserTenantRelation } from '../infra/tenant-access.js';
import { resolveTenantFromRequest } from '../request-tenant.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';
import { createDataService } from '../services/data-service.js';

export interface DataDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
}

const jsonError = (message: string) => ({ success: false, error: message });

/** 解析并校验租户：401（未登录）/ 403（关系行缺失或非法 id） */
async function scopedTenantId(
  req: Request,
  config: DataDeps['config'],
): Promise<{ tenantId: string } | { error: 401 | 403 }> {
  const session = await resolveTenantFromRequest(req, config.sessionSecret);
  if (!session) return { error: 401 };

  // 租户范围校验：session claim 必须对应 user_tenants 既有关系
  const relation = await findUserTenantRelation(config.dataDir, session.sub, session.tenantId);
  if (!relation) return { error: 403 };
  // 路径拼接前校验（与 tenant-secrets 的 fs 边界同规矩：防注入）
  if (!TENANT_ID_RE.test(session.tenantId)) return { error: 403 };

  return { tenantId: session.tenantId };
}

export function createDataRoutes({ config }: DataDeps): Hono {
  const service = createDataService({ config });
  const app = new Hono();

  /** GET /api/state — Agent 当前状态（租户未游荡 → data=null） */
  app.get('/state', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const outcome = await service.getState(scoped.tenantId);
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json(jsonError(outcome.error), outcome.status);
  });

  /** GET /api/interests — 兴趣图谱 + Shannon 熵（公式单一真相源 shared） */
  app.get('/interests', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const outcome = await service.getInterests(scoped.tenantId);
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json(jsonError(outcome.error), outcome.status);
  });

  /** GET /api/interests/history?limit=30 — 兴趣权重时间序列 */
  app.get('/interests/history', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 30) || 30, 1), 100);
    const outcome = await service.getInterestsHistory(scoped.tenantId, limit);
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json(jsonError(outcome.error), outcome.status);
  });

  /** GET /api/history — 历史推送记录（倒序；limit 默认 100 上限 200，offset 分页） */
  app.get('/history', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100) || 100, 1), 200);
    const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0);

    const outcome = await service.getHistory(scoped.tenantId, limit, offset);
    return outcome.ok
      ? c.json({ success: true, data: outcome.data.page, pagination: outcome.data.pagination })
      : c.json(jsonError(outcome.error), outcome.status);
  });

  return app;
}
