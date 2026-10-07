import { realpath } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

/** 手动 CLI 在首次读写/付费前确认数据根属于所声明租户。 */
export async function assertTenantDataDir(tenantId: string, dataDir: string): Promise<string> {
  if (!/^[a-zA-Z0-9_-]+$/.test(tenantId)) throw new Error('非法租户 ID');
  const actual = await realpath(dataDir);
  if (basename(actual) !== tenantId || basename(dirname(actual)) !== 'tenants') {
    throw new Error('租户 ID 与数据目录不匹配');
  }
  return actual;
}
