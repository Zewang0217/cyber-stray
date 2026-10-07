import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertTenantDataDir } from './tenant-dir.js';

describe('手动租户 CLI 数据根', () => {
  it('真实路径必须落在 tenants/指定租户下', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tenant-cli-'));
    try {
      const dir = join(root, 'tenants', 'tenant-a');
      await mkdir(dir, { recursive: true });
      await expect(assertTenantDataDir('tenant-a', dir)).resolves.toBe(dir);
      await expect(assertTenantDataDir('tenant-b', dir)).rejects.toThrow(/不匹配/);
      await expect(assertTenantDataDir('../tenant-a', dir)).rejects.toThrow(/非法租户/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
