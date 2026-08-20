/**
 * diary-runner 测试（#92 睡前任务 worker 拉起）
 *
 * 契约：拉起 agent 包 diary-cli 短命进程生成当天日记；
 * args 含 --tenant/--data-dir/--pet-name/--date/--personality/--diary-style，
 * pushEnabled 时加 --push-enabled true；secrets 临时文件跑完即删；退出码透传。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant } from '../tenant.js';
import { createDiaryRunner, type DiarySpawnLike, type DiaryJob } from './diary-runner.js';

describe('diary runner（#92）', () => {
  let dataDir: string;
  const spawned: { cmd: string; args: string[] }[] = [];

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-diary-run-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 't1');
    spawned.length = 0;
  });

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  /** fake spawn：记录调用、透传预设退出码 */
  const fakeSpawn =
    (exitCode = 0): DiarySpawnLike =>
    async (cmd, args) => {
      spawned.push({ cmd, args });
      return { exitCode };
    };

  function makeJob(): DiaryJob {
    return {
      tenantId: 't1',
      petId: 'pet-1',
      dataDir: join(dataDir, 'tenants', 't1'),
      petName: '小七',
      date: '2026-08-20',
      personality: 'lazy',
      diaryStyle: 'literary',
      pushEnabled: true,
      memeEnabled: true,
    };
  }

  function makeRunner(spawnFn: DiarySpawnLike) {
    return createDiaryRunner({ dataDir, timeoutMs: 30_000, spawnFn });
  }

  it('拉起 diary-cli：args 含 tenant/data-dir/pet-name/date/personality/diary-style，push 透传', async () => {
    const result = await makeRunner(fakeSpawn(0))(makeJob());
    expect(result).toEqual({ ok: true, exitCode: 0 });
    expect(spawned).toHaveLength(1);
    const { args } = spawned[0]!;
    expect(args[0]).toMatch(/diary-cli\.ts/);
    expect(args).toEqual(
      expect.arrayContaining([
        '--tenant',
        't1',
        '--data-dir',
        makeJob().dataDir,
        '--pet-name',
        '小七',
        '--date',
        '2026-08-20',
        '--personality',
        'lazy',
        '--diary-style',
        'literary',
        '--push-enabled',
        'true',
      ]),
    );
  });

  it('pushEnabled=false 不传 --push-enabled', async () => {
    await makeRunner(fakeSpawn(0))({ ...makeJob(), pushEnabled: false });
    expect(spawned[0]!.args).not.toContain('--push-enabled');
  });

  it('memeEnabled=true 传 --meme-enabled true；false 不传', async () => {
    await makeRunner(fakeSpawn(0))(makeJob());
    expect(spawned[0]!.args).toContain('--meme-enabled');
    await makeRunner(fakeSpawn(0))({ ...makeJob(), memeEnabled: false });
    expect(spawned[1]!.args).not.toContain('--meme-enabled');
  });

  it('非零退出码 → ok:false', async () => {
    const result = await makeRunner(fakeSpawn(1))(makeJob());
    expect(result).toEqual({ ok: false, exitCode: 1 });
  });

  it('无租户 secrets：不传 --secrets-file', async () => {
    await makeRunner(fakeSpawn(0))(makeJob());
    expect(spawned[0]!.args).not.toContain('--secrets-file');
  });

  it('spawn 抛错（如命令不存在）→ ok:false', async () => {
    const throwing: DiarySpawnLike = async () => {
      throw new Error('命令不存在');
    };
    const result = await makeRunner(throwing)(makeJob());
    expect(result).toEqual({ ok: false, exitCode: -1 });
  });
});
