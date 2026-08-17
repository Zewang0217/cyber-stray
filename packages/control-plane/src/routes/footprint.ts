/**
 * footprint 路由 — /api/footprint（S14 游荡足迹）
 *
 * 暴露宠物每次 loop 的每一个步骤（wander-history.json：tool/thought/url/
 * spoke/timestamp）——用户可看到宠物具体怎么探索的。租户隔离与 data.ts
 * 同规矩（session claim 定租户，x-tenant-* 忽略）。
 *
 * 数据格式：数组（agent 侧步骤记录），时间正序返回供时间线消费。
 * 缺失 = 合法空态（200 空数组）；损坏 = 显式 500（禁兜底）。
 */

import { Hono } from 'hono';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { and, eq } from 'drizzle-orm';
import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { userTenants } from '../db/schema.js';
import { tenantDataDir } from '../tenant.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';
import { resolveTenantFromRequest } from '../request-tenant.js';

export interface FootprintDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
}

const jsonError = (message: string) => ({ success: false, error: message });

/** 鉴权 + 租户校验：401 / 403 / { dir }（与 data.ts 同规矩：session claim + 关系行） */
async function scopedTenant(
  req: Request,
  config: FootprintDeps['config'],
): Promise<{ dir: string } | { error: 401 | 403 }> {
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
  return { dir: tenantDataDir(config.dataDir, session.tenantId) };
}

export function createFootprintRoutes({ config }: FootprintDeps): Hono {
  const app = new Hono();

  /** GET /api/footprint — 全部游荡步骤（时间正序） */
  app.get('/', async (c) => {
    const scoped = await scopedTenant(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }

    let content: string;
    try {
      content = await readFile(join(scoped.dir, 'wander-history.json'), 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return c.json({ success: true, data: [] });
      }
      throw error;
    }

    let steps: unknown;
    try {
      steps = JSON.parse(content);
    } catch (error) {
      console.error('[footprint] wander-history.json 损坏：', error);
      return c.json(jsonError('足迹数据损坏或不可读'), 500);
    }
    if (!Array.isArray(steps)) {
      return c.json(jsonError('足迹数据格式非法（须为数组）'), 500);
    }

    // 时间正序（时间线消费方免排序）
    const sorted = [...steps].sort((a, b) => {
      const ta = new Date(String((a as { timestamp?: unknown }).timestamp)).getTime();
      const tb = new Date(String((b as { timestamp?: unknown }).timestamp)).getTime();
      return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
    });
    return c.json({ success: true, data: sorted });
  });

  return app;
}
