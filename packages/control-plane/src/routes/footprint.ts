/**
 * footprint 路由 — /api/footprint（接口层）
 *
 * 暴露宠物每次 loop 的每一个步骤（wander-history.json：tool/thought/url/
 * spoke/timestamp）——用户可看到宠物具体怎么探索的。租户隔离走
 * requireTenant 中间件（session claim 定租户，x-tenant-* 忽略）。
 *
 * 数据格式：数组（agent 侧步骤记录），时间正序返回供时间线消费。
 * 缺失 = 合法空态（200 空数组）；损坏 = 显式 500（禁兜底）。
 * 读取在 infra/tenant-data-reader，用例在 services/data-service。
 */

import { Hono } from 'hono';
import type { ControlPlaneConfig } from '../config.js';
import { requireTenant, type TenantEnv } from '../middleware/require-tenant.js';
import { createDataService } from '../services/data-service.js';

export interface FootprintDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
}

export function createFootprintRoutes({ config }: FootprintDeps): Hono<TenantEnv> {
  const service = createDataService({ config });
  const app = new Hono<TenantEnv>();

  app.use('*', requireTenant(config));

  /** GET /api/footprint — 全部游荡步骤（时间正序） */
  app.get('/', async (c) => {
    const outcome = await service.getFootprint(c.get('tenantId'));
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json({ success: false, error: outcome.error }, outcome.status);
  });

  return app;
}
