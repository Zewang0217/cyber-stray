/**
 * pet-assets 路由 — /api/pet-assets/* + /api/pet/manifest（接口层）
 *
 * 消费侧只读素材服务：按会话租户加载自定义 IP 素材（生成管线落盘在
 * data/tenants/<sub>/pet-assets/）。web 是只读消费方（经 rewrite 代理），
 * 不碰文件系统、不写任何 agent 数据。
 *
 * 垂直切片：
 * - GET /api/pet/manifest      → 本租户素材清单（manifest.json 原样返回，含状态表）；
 *                                 无自定义素材 404 → web 回退内置 public/pet
 * - GET /api/pet-assets/<file> → 本租户素材文件（manifest.json + 状态 PNG + concept.png）
 *
 * 安全：
 * - 鉴权以 session claim 为准（x-tenant-* 一律忽略）
 * - 未登录 → 401；他人租户（无关系行 / 非法 tenant id）→ 404（不泄露存在性）
 *   ——与通用 requireTenant 的 403 语义不同，故不走共享中间件
 * - 文件名白名单 + 路径归一化越界校验，防路径穿越（与他租户 404 同语义）
 * - 文件读取在 infra/tenant-data-reader
 */

import { Hono } from 'hono';
import { extname, join, resolve, sep } from 'path';
import type { ControlPlaneConfig } from '../config.js';
import { findUserTenantRelation } from '../infra/tenant-access.js';
import { readTenantAsset } from '../infra/tenant-data-reader.js';
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
async function scopedAssetTenant(
  req: Request,
  config: PetAssetDeps['config'],
): Promise<{ tenantId: string } | { error: 401 | 404 }> {
  const session = await resolveTenantFromRequest(req, config.sessionSecret);
  if (!session) return { error: 401 };

  const relation = await findUserTenantRelation(config.dataDir, session.sub, session.tenantId);
  if (!relation) return { error: 404 };
  // 路径拼接前校验（与 tenant-secrets 的 fs 边界同规矩：防注入）
  if (!TENANT_ID_RE.test(session.tenantId)) return { error: 404 };

  return { tenantId: session.tenantId };
}

/** 素材文件名白名单（防路径穿越；pet-assets 只放 manifest + 状态 PNG + concept） */
const ASSET_FILE_RE = /^[a-z0-9][a-z0-9.-]*\.(png|json)$/;

export function createPetAssetRoutes({ config }: PetAssetDeps): Hono {
  const app = new Hono();

  /** GET /api/pet/manifest — 本租户素材清单（manifest.json 原样；无自定义 404） */
  app.get('/pet/manifest', async (c) => {
    const scoped = await scopedAssetTenant(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '素材不存在'), scoped.error);
    }
    const bytes = await readTenantAsset(config.dataDir, scoped.tenantId, 'manifest.json');
    if (!bytes) return c.json(jsonError('素材不存在'), 404);
    return c.body(new Uint8Array(bytes), 200, { 'content-type': 'application/json' });
  });

  /** GET /api/pet-assets/:file — 本租户素材文件（白名单 + 越界校验） */
  app.get('/pet-assets/:file', async (c) => {
    const scoped = await scopedAssetTenant(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '素材不存在'), scoped.error);
    }
    const file = c.req.param('file');
    // 白名单只允许顶层 flat 文件名（无路径分隔符 → 拦截穿越；manifest/状态 PNG/concept）
    if (!ASSET_FILE_RE.test(file)) {
      return c.json(jsonError('非法文件名'), 400);
    }
    // 纵深防御：归一化后必须在 pet-assets 目录内（白名单已保证，双保险）
    const assetsDir = join(tenantDataDir(config.dataDir, scoped.tenantId), 'pet-assets');
    const abs = resolve(join(assetsDir, file));
    const root = resolve(assetsDir);
    if (!abs.startsWith(root + sep)) {
      return c.json(jsonError('非法文件名'), 400);
    }
    const bytes = await readTenantAsset(config.dataDir, scoped.tenantId, file);
    if (!bytes) return c.json(jsonError('素材不存在'), 404);
    const contentType = extname(abs) === '.json' ? 'application/json' : 'image/png';
    return c.body(new Uint8Array(bytes), 200, { 'content-type': contentType });
  });

  return app;
}
