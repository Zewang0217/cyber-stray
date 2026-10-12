/**
 * trail 路由 — /api/trail（接口层）
 *
 * 关系图谱（spec #389 F 视图）的两个只读数据源：
 * - GET /api/trail/memory  记忆索引记录（memory/.index.json 的 records）
 * - GET /api/trail/speaks  全部叼回记录（history/speaks-*.jsonl）
 * 两者均支持 ?limit=N（按时间取最近 N 条，防大租户响应失控）；缺省 = 全量。
 * 缺失 = 合法空态（200 空数组）；损坏 = 显式 500（禁兜底）。
 * 读取在 infra/tenant-data-reader，用例在 services/data-service。
 */

import { Hono } from 'hono';
import type { ControlPlaneConfig } from '../config.js';
import { requireTenant, type TenantEnv } from '../auth/require-tenant.js';
import { createDataService } from '../services/data-service.js';

export interface TrailDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
}

/** ?limit= 解析：缺省 undefined（全量）；非正整数显式 400（不静默吞错参） */
function parseLimit(raw: string | undefined): number | undefined | null {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function createTrailRoutes({ config }: TrailDeps): Hono<TenantEnv> {
  const service = createDataService({ config });
  const app = new Hono<TenantEnv>();

  app.use('*', requireTenant(config));

  app.get('/memory', async (c) => {
    const limit = parseLimit(c.req.query('limit'));
    if (limit === null) return c.json({ success: false, error: 'limit 须为正整数' }, 400);
    const outcome = await service.getMemoryIndexRecords(c.get('tenantId'), limit);
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json({ success: false, error: outcome.error }, outcome.status);
  });

  app.get('/speaks', async (c) => {
    const limit = parseLimit(c.req.query('limit'));
    if (limit === null) return c.json({ success: false, error: 'limit 须为正整数' }, 400);
    const outcome = await service.getAllSpeakRecords(c.get('tenantId'), limit);
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json({ success: false, error: outcome.error }, outcome.status);
  });

  return app;
}
