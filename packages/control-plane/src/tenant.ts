/**
 * 租户注册 — S2 决策：租户键 = JWT sub（单用户租户=1 的过渡路径）
 *
 * 首登自动建租户：控制面数据根下 `tenants/<sub>/` 目录 + 注册表 JSON。
 * S3 建控制面 SQLite 后，本模块的数据落点迁入正式关系表，目录结构不变。
 */

import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { join } from 'path';

/** 租户注册表条目 */
export interface TenantRecord {
  /** 租户键（= Casdoor sub，S2 决策） */
  tenantId: string;
  /** 归属用户（Casdoor sub） */
  sub: string;
  createdAt: string;
}

/** 租户注册表（data/tenants-registry.json） */
export interface TenantRegistry {
  tenants: Record<string, TenantRecord>;
}

function registryPath(dataDir: string): string {
  return join(dataDir, 'tenants-registry.json');
}

/** 租户数据目录（agent 的 DATA_DIR = 租户键，指向此处） */
export function tenantDataDir(dataDir: string, tenantId: string): string {
  return join(dataDir, 'tenants', tenantId);
}

async function readRegistry(dataDir: string): Promise<TenantRegistry> {
  const path = registryPath(dataDir);
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (error) {
    // 注册表不存在 = 合法空值（首登前）；读取失败则抛（禁止兜底）
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { tenants: {} };
    }
    throw error;
  }
  try {
    return JSON.parse(raw) as TenantRegistry;
  } catch {
    // 注册表损坏：不静默丢数据，抛错让调用方处理（禁止兜底）
    throw new Error(`租户注册表损坏: ${path}`);
  }
}

async function writeRegistry(dataDir: string, registry: TenantRegistry): Promise<void> {
  const path = registryPath(dataDir);
  await mkdir(dataDir, { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(registry, null, 2), 'utf-8');
  // 原子替换，防并发写半截
  await rename(tmp, path);
}

/**
 * 首登自动建租户：无则创建（目录 + 注册表条目），有则返回既有。
 * 幂等：重复调用只建一次。
 *
 * @returns created = 本次是否新建
 */
export async function getOrCreateTenant(
  dataDir: string,
  sub: string,
): Promise<{ tenantId: string; created: boolean }> {
  const registry = await readRegistry(dataDir);
  const existing = registry.tenants[sub];
  if (existing) {
    return { tenantId: existing.tenantId, created: false };
  }

  const tenantId = sub; // S2：租户键 = sub
  const record: TenantRecord = { tenantId, sub, createdAt: new Date().toISOString() };

  // 先建目录再写注册表：目录失败不产生幽灵注册
  await mkdir(tenantDataDir(dataDir, tenantId), { recursive: true });
  registry.tenants[sub] = record;
  await writeRegistry(dataDir, registry);

  return { tenantId, created: true };
}
