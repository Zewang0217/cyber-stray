/**
 * meme 路由 — /api/meme（#96 表情包图鉴）
 *
 * 垂直切片用户面（图鉴）：
 * - GET  /api/meme          收录（过质检）表情包列表（时间倒序，含元数据：
 *   话题/情绪/日期/模式/图片 URL）
 * - GET  /api/meme/:id/image.png  成品图（租户私有）
 * - DELETE /api/meme/:id    删除一张（从 manifest + 磁盘）
 *
 * 约束：
 * - 鉴权/租户与 diary 同规矩（session claim + user_tenants + TENANT_ID_RE；
 *   x-tenant-* 忽略）
 * - 只展示 qcPass=true 的（质检不过不进图鉴——收录是 agent 生成管线在
 *   manifest 里标记的，这里过滤兜底）
 * - id 白名单（防路径穿越）；manifest 损坏 → 显式 500（禁兜底）
 */

import { Hono } from 'hono';
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { and, eq } from 'drizzle-orm';
import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { userTenants } from '../db/schema.js';
import { tenantDataDir } from '../tenant.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';
import { resolveTenantFromRequest } from '../request-tenant.js';
import { loadManifest, memeAssetsDir } from '../meme/storage.js';

export interface MemeDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
}

const jsonError = (message: string) => ({ success: false, error: message });

/** 表情包 id 白名单（UUID；防路径穿越） */
const MEME_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 鉴权 + 租户校验：401 / 403 / { dir }（与 diary 同规矩） */
async function scopedTenant(
  req: Request,
  config: MemeDeps['config'],
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

/** 表情包 API 视图（附图片 URL） */
interface MemeRow {
  id: string;
  topic: string;
  emotion: string;
  date: string;
  mode: string;
  createdAt: number;
}
function toMemeView(meme: MemeRow) {
  return {
    id: meme.id,
    topic: meme.topic,
    emotion: meme.emotion,
    date: meme.date,
    mode: meme.mode,
    createdAt: meme.createdAt,
    imageUrl: `/api/meme/${meme.id}/image.png`,
  };
}

/** 重写 manifest（去掉指定 id；原子写 tmp+rename） */
async function removeFromManifest(dir: string, id: string): Promise<void> {
  const assetsDir = memeAssetsDir(dir);
  const manifestPath = join(assetsDir, 'manifest.json');
  const current = await loadManifest(dir);
  const remaining = current.filter((m) => m.id !== id);
  await mkdir(assetsDir, { recursive: true });
  const tmp = `${manifestPath}.tmp`;
  await writeFile(tmp, JSON.stringify(remaining, null, 2), 'utf-8');
  await rename(tmp, manifestPath);
}

export function createMemeRoutes({ config }: MemeDeps): Hono {
  const app = new Hono();

  /** GET /api/meme — 收录表情包列表（时间倒序，只 qcPass） */
  app.get('/', async (c) => {
    const scoped = await scopedTenant(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const manifest = await loadManifest(scoped.dir);
    const pass = manifest
      .filter((m) => m.qcPass)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(toMemeView);
    return c.json({ success: true, data: pass });
  });

  /** GET /api/meme/:id/image.png — 成品图（租户私有） */
  app.get('/:id/image.png', async (c) => {
    const scoped = await scopedTenant(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const id = c.req.param('id');
    if (!MEME_ID_RE.test(id)) {
      return c.json(jsonError('非法表情包 id'), 400);
    }
    // 校验 id 在 manifest 中且过质检（防直接猜路径读未收录/他人文件）
    const manifest = await loadManifest(scoped.dir);
    const entry = manifest.find((m) => m.id === id && m.qcPass);
    if (!entry) return c.json(jsonError('表情包不存在'), 404);
    const abs = join(memeAssetsDir(scoped.dir), entry.file);
    try {
      const bytes = await readFile(abs);
      return c.body(bytes, 200, { 'content-type': 'image/png' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return c.json(jsonError('表情包图片缺失'), 404);
      }
      throw error;
    }
  });

  /** DELETE /api/meme/:id — 删除一张（manifest + 磁盘） */
  app.delete('/:id', async (c) => {
    const scoped = await scopedTenant(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const id = c.req.param('id');
    if (!MEME_ID_RE.test(id)) {
      return c.json(jsonError('非法表情包 id'), 400);
    }
    const manifest = await loadManifest(scoped.dir);
    const entry = manifest.find((m) => m.id === id);
    if (!entry) return c.json(jsonError('表情包不存在'), 404);
    // 先删 manifest 条目（原子），再删磁盘文件（失败不影响索引一致性）
    await removeFromManifest(scoped.dir, id);
    await rm(join(memeAssetsDir(scoped.dir), entry.file), { force: true });
    return c.json({ success: true, data: { id } });
  });

  return app;
}
