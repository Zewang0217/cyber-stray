/**
 * 每租户 secrets 信封加密测试（S4）
 *
 * 契约（#71）：
 * - set/get/delete/list 统一存取接口（供 worker / 推送网关）
 * - 租户 DEK 独立：跨租户不可读；删 DEK = 遗忘（永久不可解）
 * - 无明文落盘：租户目录 + SQLite 文件均不含明文（含键名——整体加密）
 * - envelope 防跨租户搬移（AAD = tenantId）
 * - 半遗忘态（密文在 DEK 缺失）显式报错，不静默重建
 * - 并发 set 不同 key 经租户级锁不丢更新
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant } from '../tenant.js';
import { openTenantSecrets } from './tenant-secrets.js';

describe('每租户 secrets 信封加密', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-secrets-'));
    _resetDb();
    await runMigrations(dataDir);
    process.env.CP_MASTER_KEY = 'cd'.repeat(32); // 固定 MK，测试可复现
    // secrets 表外键引用 tenants（S3 级联删除设计），先建租户行
    await getOrCreateTenant(dataDir, 'tenant-a');
    await getOrCreateTenant(dataDir, 'tenant-b');
  });

  afterEach(() => {
    delete process.env.CP_MASTER_KEY;
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('set/get roundtrip：加密存取解密一致', async () => {
    const s = await openTenantSecrets(dataDir, 'tenant-a');
    await s.set('deepseek_api_key', 'sk-secret-abc');
    expect(await s.get('deepseek_api_key')).toBe('sk-secret-abc');
    expect(await s.list()).toEqual(['deepseek_api_key']);
  });

  it('租户 DEK 独立：A 的 secrets B 读不到', async () => {
    const a = await openTenantSecrets(dataDir, 'tenant-a');
    const b = await openTenantSecrets(dataDir, 'tenant-b');
    await a.set('feishu_webhook', 'https://t.example/hook');
    expect(await b.get('feishu_webhook')).toBeNull();
    expect(await a.get('feishu_webhook')).toBe('https://t.example/hook');
  });

  it('忘租户：forget 后永久不可解，重建后新 DEK 可写', async () => {
    const s = await openTenantSecrets(dataDir, 'tenant-a');
    await s.set('deepseek_api_key', 'sk-old');
    await s.forget();

    const reopened = await openTenantSecrets(dataDir, 'tenant-a');
    expect(await reopened.get('deepseek_api_key')).toBeNull();

    // 重建：新 DEK 下写入新值（旧值不可恢复）
    await reopened.set('deepseek_api_key', 'sk-new');
    expect(await reopened.get('deepseek_api_key')).toBe('sk-new');
  });

  it('forget 后存活实例立即可见（无缓存绕过）', async () => {
    const worker = await openTenantSecrets(dataDir, 'tenant-a');
    const admin = await openTenantSecrets(dataDir, 'tenant-a');
    await worker.set('k', 'v1');
    await admin.forget();
    expect(await worker.get('k')).toBeNull(); // 无缓存：立即失效
  });

  it('delete 移除单个 secret', async () => {
    const s = await openTenantSecrets(dataDir, 'tenant-a');
    await s.set('k1', 'v1');
    await s.set('k2', 'v2');
    expect(await s.delete('k1')).toBe(true);
    expect(await s.delete('k1')).toBe(false);
    expect(await s.list()).toEqual(['k2']);
  });

  it('get 不存在的 name 返回 null（不是抛错）', async () => {
    const s = await openTenantSecrets(dataDir, 'tenant-a');
    expect(await s.get('nope')).toBeNull();
  });

  it('无明文落盘：租户目录 + SQLite 文件不含明文值与键名', async () => {
    const s = await openTenantSecrets(dataDir, 'tenant-a');
    const plaintext = 'sk-plaintext-marker-42';
    const keyName = 'deepseek_api_key';
    await s.set(keyName, plaintext);

    // 扫描 dataDir 下所有文件（含 control.db），明文值与键名不得出现
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(dataDir);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const buf = readFileSync(f);
      expect(buf.includes(Buffer.from(plaintext, 'utf8')), `明文值出现在 ${f}`).toBe(false);
      expect(buf.includes(Buffer.from(keyName, 'utf8')), `键名出现在 ${f}`).toBe(false);
    }
  });

  it('envelope 防跨租户搬移：AAD=tenantId，搬行到 B 后解密失败', async () => {
    const a = await openTenantSecrets(dataDir, 'tenant-a');
    const b = await openTenantSecrets(dataDir, 'tenant-b');
    await a.set('deepseek_api_key', 'sk-a');
    await b.set('dummy', 'x'); // 先给 B 建 DEK，隔离 DEK 缺失路径

    // 模拟攻击：把 A 的 DB 行抄给 B（SQLite 无租户级隔离，行可复制）
    const db = await getDb(dataDir);
    const { tenantSecrets } = await import('../db/schema.js');
    const rows = await db.select().from(tenantSecrets).where(
      eq(tenantSecrets.tenantId, 'tenant-a'),
    ).all();
    expect(rows).toHaveLength(1);
    await db.insert(tenantSecrets).values({
      tenantId: 'tenant-b',
      encrypted: rows[0]!.encrypted,
    }).onConflictDoUpdate({
      target: tenantSecrets.tenantId,
      set: { encrypted: rows[0]!.encrypted },
    }).run();

    // B 有 DEK，但密文是 A 的 AAD 加密 → tag 校验失败
    await expect(b.get('deepseek_api_key')).rejects.toThrow(/解密失败/i);
  });

  it('半遗忘态：密文在 DEK 缺失 → get 抛错且不落盘新 DEK', async () => {
    const s = await openTenantSecrets(dataDir, 'tenant-a');
    await s.set('k', 'v');
    // 模拟 DEK 文件被删（行还在）
    rmSync(join(dataDir, 'tenants', 'tenant-a', 'secrets', 'dek.enc'));

    await expect(s.get('k')).rejects.toThrow(/DEK 文件缺失|半遗忘态/i);
    // 不静默重建
    expect(existsSync(join(dataDir, 'tenants', 'tenant-a', 'secrets', 'dek.enc'))).toBe(
      false,
    );

    // 半遗忘态下 set 也抛错（先 forget 再重配）
    await expect(s.set('k', 'v2')).rejects.toThrow(/DEK 文件缺失|半遗忘态/i);
  });

  it('并发 set 不同 key：租户级锁下不丢更新', async () => {
    const s = await openTenantSecrets(dataDir, 'tenant-a');
    await Promise.all([
      s.set('key-1', 'v1'),
      s.set('key-2', 'v2'),
      s.set('key-3', 'v3'),
    ]);
    expect(await s.list()).toEqual(expect.arrayContaining(['key-1', 'key-2', 'key-3']));
    expect(await s.get('key-1')).toBe('v1');
    expect(await s.get('key-2')).toBe('v2');
    expect(await s.get('key-3')).toBe('v3');
  });

  it('非法 tenantId（路径注入形态）拒绝', async () => {
    await expect(openTenantSecrets(dataDir, '../evil')).rejects.toThrow(/非法 tenantId/i);
  });

  it('DEK 文件缺失自动初始化（首次 set 生成，原子）', async () => {
    const s = await openTenantSecrets(dataDir, 'tenant-a');
    const marker = 'sk-plaintext-marker';
    await s.set('k', marker);
    const dekPath = join(dataDir, 'tenants', 'tenant-a', 'secrets', 'dek.enc');
    expect(statSync(dekPath).isFile()).toBe(true);
    expect(statSync(dekPath).mode & 0o777).toBe(0o600);
    // DEK 文件是 MK 包裹的密文，不含明文值
    expect(readFileSync(dekPath, 'utf8')).not.toContain(marker);
  });
});
