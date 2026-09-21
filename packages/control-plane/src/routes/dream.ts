/**
 * dream 路由 — /api/dream（接口层）
 *
 * 暴露租户的当晚梦境（diary/dreams/YYYY-MM-DD.md，文件系统 markdown 契约；
 * 梦境与日记分离，睡前任务与日记同刻预生成，夜间访问零延迟读取）：
 * - GET /api/dream         梦境列表（时间倒序：date/title/excerpt）
 * - GET /api/dream/:date   单篇梦境（date/content）
 *
 * 租户隔离走 requireTenant 中间件；读取在 infra/tenant-data-reader，
 * 用例在 services/data-service（与日记同一数据面）。缺失 = 合法空态，
 * 损坏 = 显式 500（禁兜底）。
 */

import { Hono } from 'hono';
import type { ControlPlaneConfig } from '../config.js';
import { requireTenant, type TenantEnv } from '../middleware/require-tenant.js';
import { createDataService } from '../services/data-service.js';

export interface DreamDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
}

/** 梦境日期合法性（YYYY-MM-DD，防路径穿越） */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function createDreamRoutes({ config }: DreamDeps): Hono<TenantEnv> {
  const service = createDataService({ config });
  const app = new Hono<TenantEnv>();

  app.use('*', requireTenant(config));

  /** GET /api/dream — 梦境列表（时间倒序，含标题/摘录） */
  app.get('/', async (c) => {
    const outcome = await service.getDreamList(c.get('tenantId'));
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json({ success: false, error: outcome.error }, outcome.status);
  });

  /** GET /api/dream/:date — 单篇梦境（YYYY-MM-DD） */
  app.get('/:date', async (c) => {
    const date = c.req.param('date');
    if (!DATE_RE.test(date)) {
      return c.json({ success: false, error: 'date 须为 YYYY-MM-DD' }, 400);
    }

    const outcome = await service.getDreamEntry(c.get('tenantId'), date);
    if (!outcome.ok) {
      return c.json({ success: false, error: outcome.error }, outcome.status);
    }
    return outcome.found
      ? c.json({ success: true, data: outcome.data })
      : c.json({ success: false, error: '该日期没有梦境' }, 404);
  });

  return app;
}
