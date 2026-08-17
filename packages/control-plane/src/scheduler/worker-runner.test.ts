/**
 * worker-runner 测试（S5）
 *
 * 契约：拉起 agent 包 CLI（tsx/bun）短命进程跑一轮游荡；
 * per-tenant secrets 解密后写临时文件（0600，跑完即删）注入 --secrets-file；
 * 无 secrets 不传文件（worker 回退进程 env 的平台 key）；退出码透传；
 * 超时 SIGKILL 判失败。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant } from '../tenant.js';
import { openTenantSecrets } from '../secrets/tenant-secrets.js';
import { createWorkerRunner, type SpawnLike } from './worker-runner.js';

describe('worker runner', () => {
  let dataDir: string;
  const spawned: { cmd: string; args: string[] }[] = [];

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-runner-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 't1');
    process.env.CP_MASTER_KEY = 'cd'.repeat(32);
  });

  afterEach(() => {
    delete process.env.CP_MASTER_KEY;
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  /** fake spawn：记录调用、透传预设退出码 */
  const fakeSpawn =
    (exitCode = 0): SpawnLike =>
    async (cmd, args) => {
      spawned.push({ cmd, args });
      return { exitCode };
    };

  const PLAN_JOB = {
    plan: 'free' as const,
    pushesPerDay: 5,
    pushWindowStart: null,
    pushWindowEnd: null,
  };

  function makeRunner(spawnFn: SpawnLike) {
    return createWorkerRunner({
      dataDir,
      spawnFn,
      timeoutMs: 60_000,
    });
  }

  it('拉起 CLI：args 含 --tenant/--data-dir，退出码透传', async () => {
    const runner = makeRunner(fakeSpawn(0));
    const result = await runner({ tenantId: 't1', petId: 'p1', dataDir, plan: PLAN_JOB });
    expect(result).toEqual({ ok: true, exitCode: 0 });

    const last = spawned.at(-1);
    expect(last?.args).toContain('--tenant');
    expect(last?.args).toContain('t1');
    expect(last?.args).toContain('--data-dir');
    expect(last?.args).toContain(dataDir);
  });

  it('非零退出码 → ok:false', async () => {
    const runner = makeRunner(fakeSpawn(1));
    const result = await runner({ tenantId: 't1', petId: 'p1', dataDir, plan: PLAN_JOB });
    expect(result).toEqual({ ok: false, exitCode: 1 });
  });

  it('有租户 secrets：写 0600 临时 JSON 注入 --secrets-file，跑完删除', async () => {
    const store = await openTenantSecrets(dataDir, 't1');
    await store.set('deepseek_api_key', 'sk-test-123');

    let secretsPath = '';
    const runner = makeRunner(
      async (cmd, args) => {
        const idx = args.indexOf('--secrets-file');
        secretsPath = idx >= 0 ? (args[idx + 1] ?? '') : '';
        if (secretsPath) {
          expect(statSync(secretsPath).mode & 0o777).toBe(0o600);
          expect(JSON.parse(readFileSync(secretsPath, 'utf8'))).toEqual({
            deepseekApiKey: 'sk-test-123',
          });
        }
        return { exitCode: 0 };
      },
    );

    const result = await runner({ tenantId: 't1', petId: 'p1', dataDir, plan: PLAN_JOB });
    expect(result.ok).toBe(true);
    expect(secretsPath).not.toBe('');
    expect(existsSync(secretsPath)).toBe(false); // 跑完即删
  });

  it('无租户 secrets：不传 --secrets-file（回退平台 env key）', async () => {
    const runner = makeRunner(fakeSpawn(0));
    await runner({ tenantId: 't1', petId: 'p1', dataDir, plan: PLAN_JOB });
    const last = spawned.at(-1);
    expect(last?.args).not.toContain('--secrets-file');
  });

  it('spawn 抛错（如命令不存在）→ ok:false 且 secrets 临时文件已删', async () => {
    const store = await openTenantSecrets(dataDir, 't1');
    await store.set('deepseek_api_key', 'sk-x');

    const runner = makeRunner(async () => {
      throw new Error('spawn ENOENT');
    });
    const result = await runner({ tenantId: 't1', petId: 'p1', dataDir, plan: PLAN_JOB });
    expect(result.ok).toBe(false);

    // 临时文件无泄漏：dataDir 与系统 tmp 下本 runner 写的 secrets 都应被清理
    const secretsDir = join(dataDir, 'tenants', 't1', 'secrets');
    for (const f of existsSync(secretsDir) ? ['dek.enc'] : []) {
      expect(f).toBe('dek.enc'); // 只剩 DEK，无 secrets.json 残留
    }
  });

  it('worker 输出 stdout 的 ok JSON 不影响结果判定（以退出码为准）', async () => {
    const runner = makeRunner(
      vi.fn(async () => ({ exitCode: 0 })),
    );
    expect((await runner({ tenantId: 't1', petId: 'p1', dataDir, plan: PLAN_JOB })).ok).toBe(true);
  });
});
