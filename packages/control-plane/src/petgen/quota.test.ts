/**
 * 配额逻辑测试（#94；8e8307c 收紧为滚动七天口径）
 *
 * 契约：petGenWeeklyQuota 只统计最近 7×24h 内 status=done 的任务，
 * 失败任务不占配额，满七天立即恢复。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant } from '../infra/tenant.js';
import { petGenTasks } from '../db/schema.js';
import { petGenWeeklyQuota } from './quota.js';

describe('petGenWeeklyQuota（DB 计数）', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-petgen-quota-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    await getOrCreateTenant(dataDir, 'bob');
  });

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('无任务 → used 0 / remaining 1', async () => {
    const db = await getDb(dataDir);
    const q = await petGenWeeklyQuota(db, 'alice', false, new Date(2026, 7, 10).getTime());
    expect(q).toMatchObject({ used: 0, remaining: 1, limit: 1, unlimited: false, resetAt: null });
  });

  it('滚动七天：失败不占次数，满七天立即恢复；月底不会提前恢复', async () => {
    const db = await getDb(dataDir);
    const completed = Date.parse('2026-09-30T15:00:00Z');
    await db.insert(petGenTasks).values([
      { id: 'weekly', tenantId: 'alice', specText: '猫', status: 'done', completedAt: completed },
      { id: 'failed-weekly', tenantId: 'alice', specText: '猫', status: 'failed', completedAt: completed + 1 },
      { id: 'other-weekly', tenantId: 'bob', specText: '猫', status: 'done', completedAt: completed + 1 },
    ]).run();
    const reset = completed + 7 * 86_400_000;
    expect(await petGenWeeklyQuota(db, 'alice', false, reset - 1)).toMatchObject({
      used: 1, limit: 1, remaining: 0, unlimited: false, resetAt: new Date(reset).toISOString(),
    });
    expect(await petGenWeeklyQuota(db, 'alice', false, reset)).toMatchObject({ used: 0, remaining: 1, resetAt: null });
    expect(await petGenWeeklyQuota(db, 'alice', true, reset - 1)).toMatchObject({
      unlimited: true, limit: null, remaining: null, resetAt: null,
    });
  });

  it('租户覆盖 limit（shared/quota）：按覆盖值计算剩余', async () => {
    const db = await getDb(dataDir);
    const now = Date.now();
    await db.insert(petGenTasks).values([
      { id: 'ov1', tenantId: 'alice', specText: '猫', status: 'done', completedAt: now },
    ]).run();
    expect(await petGenWeeklyQuota(db, 'alice', false, now, 3)).toMatchObject({
      used: 1, limit: 3, remaining: 2,
    });
  });

});
