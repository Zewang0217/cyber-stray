/**
 * 租户注册（S3：SQLite + Drizzle）
 *
 * 首登自动建租户：控制面 DB 的 tenants + user_tenants 行 + 租户数据目录
 * `tenants/<sub>/`（agent 的 markdown 数据层，不迁移）。
 *
 * 租户键 = Casdoor sub（uuid）。幂等（含并发首登）：tenants 主键冲突即已有，
 * onConflictDoNothing 原子处理。S2 的 JSON 注册表被 DB 取代，发现残留时归档。
 */

import { mkdir, rename } from 'fs/promises';
import { join } from 'path';
import { getDb } from './db/client.js';
import { tenants, userTenants } from './db/schema.js';

/** 租户数据目录（agent 的 DATA_DIR = 租户键，指向此处） */
export function tenantDataDir(dataDir: string, tenantId: string): string {
  return join(dataDir, 'tenants', tenantId);
}

/** 租户注册结果 */
export interface TenantResult {
  tenantId: string;
  created: boolean;
}

/** S2 遗留 JSON 注册表（DB 取代后归档，防误读为活状态） */
const LEGACY_REGISTRY_FILE = 'tenants-registry.json';

/**
 * 首登自动建租户：DB 建租户行 + 用户↔租户绑定 + 租户数据目录。
 *
 * 原子性：tenants + user_tenants 在同一事务；tenants 主键冲突（并发首登/回调
 * 重放）经 onConflictDoNothing 短路，返回既有租户而非 500。
 * 幂等：已存在则返回 created:false，不重复建。
 */
export async function getOrCreateTenant(
  dataDir: string,
  sub: string,
  name = sub,
): Promise<TenantResult> {
  const db = await getDb(dataDir);
  await archiveLegacyRegistry(dataDir);

  // 先建数据目录（幂等）；DB 失败留空目录可被下次登录自愈（mkdir 幂等）
  await mkdir(tenantDataDir(dataDir, sub), { recursive: true });

  const created = await db.transaction(async (tx) => {
    const result = await tx
      .insert(tenants)
      .values({ id: sub, name })
      .onConflictDoNothing()
      .run();
    if (result.rowsAffected === 0) {
      return false; // 并发下另一请求已建
    }
    await tx
      .insert(userTenants)
      .values({ userId: sub, tenantId: sub, role: 'owner' })
      .onConflictDoNothing()
      .run();
    return true;
  });

  return { tenantId: sub, created };
}

/** 归档 S2 遗留 JSON 注册表（存在则改名 .bak；幂等） */
async function archiveLegacyRegistry(dataDir: string): Promise<void> {
  const legacy = join(dataDir, LEGACY_REGISTRY_FILE);
  try {
    await rename(legacy, `${legacy}.bak`);
  } catch (error) {
    // 文件不存在 = 正常（已归档或从未有过）；其他错误抛（禁止兜底）
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
