/**
 * pet-assets 路由 — /api/pet-assets/* + /api/pet/manifest（#95 IP 消费侧）
 *
 * 消费侧只读素材服务：按会话租户加载自定义 IP 素材（#94 生成管线落盘在
 * data/tenants/<sub>/pet-assets/）。web 是只读消费方（经 rewrite 代理），
 * 不碰文件系统、不写任何 agent 数据。
 *
 * 垂直切片：
 * - GET /api/pet/manifest      → 本租户素材清单（manifest.json 原样返回，含状态表）；
 *                                 无自定义素材 404 → web 回退内置 public/pet
 * - GET /api/pet-assets/<file> → 本租户素材文件（manifest.json + 状态 PNG + concept.png）
 *
 * 安全：
 * - 鉴权/租户以 session claim 为准（resolveTenantFromRequest，x-tenant-* 一律忽略）
 * - 未登录 → 401；他人租户（无 user_tenants 关系 / 非法 tenant id）→ 404（不泄露存在性）
 * - 文件名白名单 + 路径归一化越界校验，防路径穿越（与他租户 404 同语义）
 */

import { Hono } from 'hono';
import { readFile } from 'fs/promises';
import { extname, join, resolve, sep } from 'path';
import { and, eq } from 'drizzle-orm';
import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { userTenants } from '../db/schema.js';
import { resolveTenantFromRequest } from '../request-tenant.js';
import { tenantDataDir } from '../tenant.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';

export interface PetAssetDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
}

const jsonError = (message: string) => ({ success: false, error: message });

/**
 * 鉴权 + 租户校验（与 data/pets 同规矩，但他人租户语义为 404）：
 * 未登录 → 401；无关系行 / 非法 tenant id → 404（不泄露是否存在其他租户素材）。
 */
async function scopedTenant(
  req: Request,
  config: PetAssetDeps['config'],
): Promise<{ tenantId: string } | { error: 401 | 404 }> {
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
  if (!relation) return { error: 404 };
  // 路径拼接前校验（与 tenant-secrets 的 fs 边界同规矩：防注入）
  if (!TENANT_ID_RE.test(session.tenantId)) return { error: 404 };

  return { tenantId: session.tenantId };
}

/** 素材文件名白名单（防路径穿越；pet-assets 只放 manifest + 状态 PNG + concept） */
const ASSET_FILE_RE = /^[a-z0-9][a-z0-9.-]*\.(png|json)$/;

/** 文件缺失（ENOENT）= 404；其他读/解析错误显式抛（禁兜底） */
function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export function createPetAssetRoutes({ config }: PetAssetDeps): Hono {
  const app = new Hono();

  /** GET /api/pet/manifest — 本租户素材清单（manifest.json 原样；无自定义 404） */
  app.get('/pet/manifest', async (c) => {
    const scoped = await scopedTenant(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '素材不存在'), scoped.error);
    }
    const abs = join(tenantDataDir(config.dataDir, scoped.tenantId), 'pet-assets', 'manifest.json');
    try {
      const bytes = await readFile(abs);
      return c.body(bytes, 200, { 'content-type': 'application/json' });
    } catch (error) {
      if (isEnoent(error)) return c.json(jsonError('素材不存在'), 404);
      throw error;
    }
  });

  /** GET /api/pet-assets/:file — 本租户素材文件（白名单 + 越界校验） */
  app.get('/pet-assets/:file', async (c) => {
    const scoped = await scopedTenant(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '素材不存在'), scoped.error);
    }
    const file = c.req.param('file');
    // 白名单只允许顶层 flat 文件名（无路径分隔符 → 拦截穿越；manifest/状态 PNG/concept）
    if (!ASSET_FILE_RE.test(file)) {
      return c.json(jsonError('非法文件名'), 400);
    }
    const assetsDir = join(tenantDataDir(config.dataDir, scoped.tenantId), 'pet-assets');
    const abs = resolve(join(assetsDir, file));
    const root = resolve(assetsDir);
    // 纵深防御：归一化后必须在 pet-assets 目录内（白名单已保证，双保险）
    if (!abs.startsWith(root + sep)) {
      return c.json(jsonError('非法文件名'), 400);
    }
    try {
      const bytes = await readFile(abs);
      const contentType = extname(abs) === '.json' ? 'application/json' : 'image/png';
      return c.body(bytes, 200, { 'content-type': contentType });
    } catch (error) {
      if (isEnoent(error)) return c.json(jsonError('素材不存在'), 404);
      throw error;
    }
  });

  return app;
}
