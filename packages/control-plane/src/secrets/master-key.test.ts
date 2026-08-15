/**
 * master key 加载测试（S4）
 *
 * 契约：env CP_MASTER_KEY（64 hex = 32 字节）优先；否则 dataDir/master.key
 * （首次自动生成，chmod 600，幂等复用）。非法输入抛错（不兜底）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadMasterKey } from './master-key.js';

describe('master key 加载', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-mk-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('env CP_MASTER_KEY 优先（hex 解码为 32 字节）', async () => {
    const hex = 'ab'.repeat(32);
    const key = await loadMasterKey(dataDir, { CP_MASTER_KEY: hex });
    expect(key).toEqual(Buffer.from(hex, 'hex'));
    // env 提供时不落盘
    expect(() => statSync(join(dataDir, 'master.key'))).toThrow();
  });

  it('无 env：首次生成 master.key（32 字节 hex，chmod 600）', async () => {
    const key = await loadMasterKey(dataDir, {});
    expect(key).toHaveLength(32);
    const file = join(dataDir, 'master.key');
    expect(readFileSync(file, 'utf8')).toMatch(/^[0-9a-f]{64}\n$/);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('无 env：已存在 master.key 则复用（幂等）', async () => {
    const first = await loadMasterKey(dataDir, {});
    const second = await loadMasterKey(dataDir, {});
    expect(second).toEqual(first);
  });

  it('非法 CP_MASTER_KEY（非 64 hex）抛错，不兜底', async () => {
    await expect(loadMasterKey(dataDir, { CP_MASTER_KEY: 'short' })).rejects.toThrow(
      /CP_MASTER_KEY.*hex/i,
    );
  });

  it('master.key 文件内容非法 → 抛错（不静默重建）', async () => {
    writeFileSync(join(dataDir, 'master.key'), 'not-a-key\n');
    await expect(loadMasterKey(dataDir, {})).rejects.toThrow(/master\.key 内容非法/i);
  });

  it('env 与既有文件不一致 → 抛错（防静默切换解不开既有 DEK）', async () => {
    writeFileSync(join(dataDir, 'master.key'), 'ab'.repeat(32) + '\n');
    await expect(
      loadMasterKey(dataDir, { CP_MASTER_KEY: 'ef'.repeat(32) }),
    ).rejects.toThrow(/不一致/i);
    // 一致则不抛
    await expect(
      loadMasterKey(dataDir, { CP_MASTER_KEY: 'ab'.repeat(32) }),
    ).resolves.toEqual(Buffer.from('ab'.repeat(32), 'hex'));
  });

  it('生产环境无 env 无文件 → 抛错（禁止自动生成落盘）', async () => {
    await expect(
      loadMasterKey(dataDir, { NODE_ENV: 'production' }),
    ).rejects.toThrow(/生产环境.*CP_MASTER_KEY/i);
    // 生产 + env 可用
    await expect(
      loadMasterKey(dataDir, { NODE_ENV: 'production', CP_MASTER_KEY: 'ab'.repeat(32) }),
    ).resolves.toHaveLength(32);
  });
});
