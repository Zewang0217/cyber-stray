/**
 * meme 路由 — /api/meme（接口层）
 *
 * 表情包图鉴：收录列表（只 qcPass）、成品图、删除（manifest + 磁盘）。
 * 租户隔离走 requireTenant 中间件；用例在 services/meme-service，
 * manifest/磁盘单一实现复用 meme/storage。
 *
 * id 白名单（UUID，防路径穿越）校验留本层；manifest 损坏 → 显式 500（禁兜底）。
 */

import { Hono } from 'hono';
import type { ControlPlaneConfig } from '../config.js';
import { requireTenant, type TenantEnv } from '../middleware/require-tenant.js';
import { createMemeService } from '../services/meme-service.js';

export interface MemeDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
}

const jsonError = (message: string) => ({ success: false, error: message });

/** 表情包 id 白名单（UUID；防路径穿越） */
const MEME_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createMemeRoutes({ config }: MemeDeps): Hono<TenantEnv> {
  const service = createMemeService({ config });
  const app = new Hono<TenantEnv>();

  app.use('*', requireTenant(config));

  /** GET /api/meme — 收录表情包列表（时间倒序，只 qcPass） */
  app.get('/', async (c) => {
    return c.json({ success: true, data: await service.listPass(c.get('tenantId')) });
  });

  /** GET /api/meme/:id/image.png — 成品图（租户私有） */
  app.get('/:id/image.png', async (c) => {
    const id = c.req.param('id');
    if (!MEME_ID_RE.test(id)) {
      return c.json(jsonError('非法表情包 id'), 400);
    }
    const bytes = await service.getImage(c.get('tenantId'), id);
    return bytes
      ? c.body(new Uint8Array(bytes), 200, { 'content-type': 'image/png' })
      : c.json(jsonError('表情包不存在'), 404);
  });

  /** DELETE /api/meme/:id — 删除一张（manifest + 磁盘） */
  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    if (!MEME_ID_RE.test(id)) {
      return c.json(jsonError('非法表情包 id'), 400);
    }
    const result = await service.remove(c.get('tenantId'), id);
    return result
      ? c.json({ success: true, data: result })
      : c.json(jsonError('表情包不存在'), 404);
  });

  return app;
}
