/**
 * evolution 路由 — /api/evolution*（接口层）
 *
 * 用户可追溯宠物进化过程：兴趣快照时间序列 + 反馈事件 + 游荡摘要。
 * 回滚：把某快照的兴趣权重还原为 user-interests.json（原子写），并追加
 * 一条 source=rollback 快照——可追溯 + 可撤销。
 *
 * 安全：租户只由 session claim 决定（x-tenant-* 忽略）；回滚 hash 查找
 * 限本租户历史，他租户的 hash 统一 404（不暴露存在性）。
 *
 * 快照纯规则在 domain/evolution，文件 I/O 在 infra/evolution-store，
 * 用例在 services/evolution-service。
 */

import { Hono } from 'hono';
import type { ControlPlaneConfig } from '../config.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';
import { resolveTenantFromRequest } from '../auth/request-tenant.js';
import { createEvolutionService } from '../services/evolution-service.js';

export interface EvolutionDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
}

const jsonError = (message: string) => ({ success: false, error: message });

/**
 * 鉴权 + 租户校验：401 / 403 / { tenantId }。
 * 注意：与其他路由不同，此处历史实现不校验 user_tenants 关系行
 * （仅 session claim + id 格式）——行为保持原样，是否收紧由持机人裁决。
 */
async function scopedTenant(
  req: Request,
  config: EvolutionDeps['config'],
): Promise<{ tenantId: string } | { error: 401 | 403 }> {
  const session = await resolveTenantFromRequest(req, config.sessionSecret);
  if (!session) return { error: 401 };
  if (!TENANT_ID_RE.test(session.tenantId)) return { error: 403 };
  return { tenantId: session.tenantId };
}

export function createEvolutionRoutes({ config }: EvolutionDeps): Hono {
  const service = createEvolutionService({ config });
  const app = new Hono();

  /** GET /api/evolution — 快照序列 + 反馈事件 + 游荡摘要 */
  app.get('/', async (c) => {
    const scoped = await scopedTenant(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    return c.json({ success: true, data: await service.getEvolution(scoped.tenantId) });
  });

  /** POST /api/evolution/rollback — 回滚到指定快照（限本租户历史） */
  app.post('/rollback', async (c) => {
    const scoped = await scopedTenant(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }

    let body: { hash?: unknown };
    try {
      body = (await c.req.json()) as { hash?: unknown };
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    const hash = body.hash;
    // agent 快照 hash 为 8 位 hex（DJB2）；CP 回滚快照为 16 位 hex（sha256 截断）。
    // 两者都接受——按原文精确查找
    if (typeof hash !== 'string' || !/^[0-9a-f]{8,16}$/.test(hash)) {
      return c.json(jsonError('hash 须为 8-16 位 hex'), 400);
    }

    const outcome = await service.rollback(scoped.tenantId, hash);
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json(jsonError(outcome.error), outcome.status);
  });

  return app;
}
