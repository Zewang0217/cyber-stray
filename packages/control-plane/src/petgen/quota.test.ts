/**
 * 配额逻辑测试（#94）
 *
 * 契约：monthStart/nextMonthStart 为本地自然月边界；petGenQuota 只统计
 * 当前自然月 status=done 的任务（completedAt ≥ 本月 1 日），失败任务不占配额。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant } from '../tenant.js';
import { petGenTasks } from '../db/schema.js';
import { monthStart, nextMonthStart, petGenQuota } from './quota.js';

describe('quota 月边界', () => {
  it('monthStart：当月 1 日 00:00（本地时区）', () => {
    const ts = new Date(2026, 7, 20, 15, 30).getTime(); // 2026-08-20
    const start = monthStart(ts);
    const d = new Date(start);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(0);
  });

  it('nextMonthStart：跨年正确', () => {
    const d = new Date(nextMonthStart(new Date(2026, 11, 15).getTime()));
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(1);
  });
});

describe('petGenQuota（DB 计数）', () => {
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

  it('无任务 → used 0 / remaining = limit', async () => {
    const db = await getDb(dataDir);
    const q = await petGenQuota(db, 'alice', 2, new Date(2026, 7, 10).getTime());
    expect(q).toEqual({ used: 0, remaining: 2, limit: 2 });
  });

  it('只统计本月 done；失败任务不占配额；跨租户隔离', async () => {
    const db = await getDb(dataDir);
    const now = new Date(2026, 7, 10).getTime();
    const doneThisMonth = new Date(2026, 7, 5).getTime();
    const doneLastMonth = new Date(2026, 6, 30).getTime();
    await db.insert(petGenTasks).values([
      { id: 't1', tenantId: 'alice', specText: '猫', status: 'done', completedAt: doneThisMonth },
      { id: 't2', tenantId: 'alice', specText: '猫', status: 'done', completedAt: doneLastMonth },
      { id: 't3', tenantId: 'alice', specText: '猫', status: 'failed', completedAt: doneThisMonth },
      { id: 't4', tenantId: 'bob', specText: '猫', status: 'done', completedAt: doneThisMonth },
    ]).run();
    const q = await petGenQuota(db, 'alice', 2, now);
    expect(q.used).toBe(1); // t1 本月 done；t2 上月不计；t3 失败不计；t4 他人不计
    expect(q.remaining).toBe(1);
  });

  it('超限 → remaining 0', async () => {
    const db = await getDb(dataDir);
    const now = new Date(2026, 7, 10).getTime();
    await db.insert(petGenTasks).values([
      { id: 'a', tenantId: 'alice', specText: '猫', status: 'done', completedAt: now },
      { id: 'b', tenantId: 'alice', specText: '猫', status: 'done', completedAt: now },
    ]).run();
    const q = await petGenQuota(db, 'alice', 2, now);
    expect(q.remaining).toBe(0);
  });
});
