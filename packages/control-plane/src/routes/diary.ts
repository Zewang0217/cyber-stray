/**
 * diary 路由 — /api/diary（接口层）
 *
 * 暴露租户的日记（diary/YYYY-MM-DD.md，文件系统 markdown 契约）：
 * - GET /api/diary         日记列表（时间倒序：date/title/excerpt）
 * - GET /api/diary/:date   单篇日记（date/content）
 *
 * 租户隔离走 requireTenant 中间件（session claim 定租户，x-tenant-* 忽略）。
 * 缺失 = 合法空态（200 空列表 / 404）；损坏 = 显式 500（禁兜底）。
 * 文件读取在 infra/tenant-data-reader，用例在 services/data-service。
 */

import { Hono } from 'hono';
import type { ControlPlaneConfig } from '../config.js';
import { requireTenant, type TenantEnv } from '../middleware/require-tenant.js';
import { createDataService, type DiaryEntry } from '../services/data-service.js';

export interface DiaryDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
}

export type { DiaryEntry };

/** 日记日期合法性（YYYY-MM-DD，防路径穿越） */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function createDiaryRoutes({ config }: DiaryDeps): Hono<TenantEnv> {
  const service = createDataService({ config });
  const app = new Hono<TenantEnv>();

  app.use('*', requireTenant(config));

  /** GET /api/diary — 日记列表（时间倒序，含标题/摘录） */
  app.get('/', async (c) => {
    const outcome = await service.getDiaryList(c.get('tenantId'));
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json({ success: false, error: outcome.error }, outcome.status);
  });

  /** GET /api/diary/:date — 单篇日记（YYYY-MM-DD） */
  app.get('/:date', async (c) => {
    const date = c.req.param('date');
    if (!DATE_RE.test(date)) {
      return c.json({ success: false, error: 'date 须为 YYYY-MM-DD' }, 400);
    }

    const outcome = await service.getDiaryEntry(c.get('tenantId'), date);
    if (!outcome.ok) {
      return c.json({ success: false, error: outcome.error }, outcome.status);
    }
    return outcome.found
      ? c.json({ success: true, data: outcome.data })
      : c.json({ success: false, error: '该日期没有日记' }, 404);
  });

  return app;
}
