/**
 * migrate-pet-stats 测试（#216 / ADR-0013）
 *
 * 契约：只回填 pets 缺失的 mood/temper（energy/boredom 是活数据，绝不动）；
 * 幂等标记 = pets.mood 非空 → 重跑 already-migrated；report 落盘可查。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { pets } from '../db/schema.js';
import { getOrCreateTenant } from '../tenant.js';
import { migratePetStats, type PetStatsMigrationEntry } from './migrate-pet-stats.js';

describe('migratePetStats（state.json mood/temper → pets）', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-migstats-'));
    _resetDb();
    await runMigrations(dataDir);
  });

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function addPet(id: string, tenantId: string, extra?: Partial<typeof pets.$inferInsert>) {
    const db = await getDb(dataDir);
    await db.insert(pets).values({ id, tenantId, name: id, boredom: 60, energy: 55, ...extra }).run();
  }

  function writeState(tenantId: string, state: Record<string, unknown>): void {
    const dir = join(dataDir, 'tenants', tenantId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'state.json'), JSON.stringify(state), 'utf-8');
  }

  function entryOf(report: { entries: PetStatsMigrationEntry[] }, petId: string) {
    return report.entries.find((e) => e.petId === petId);
  }

  it('存量行回填 mood/temper；energy/boredom 保持库值不动', async () => {
    await getOrCreateTenant(dataDir, 't1');
    await addPet('p1', 't1');
    writeState('t1', { boredom: 0, energy: 0, mood: 'excited', temper: 13 });

    const report = await migratePetStats(dataDir);
    expect(entryOf(report, 'p1')?.status).toBe('migrated');

    const db = await getDb(dataDir);
    const pet = await db.select().from(pets).where(eq(pets.id, 'p1')).get();
    expect(pet?.mood).toBe('excited');
    expect(pet?.temper).toBe(13);
    // 关键决策：陈旧副本（0/0）不回填——pets 里是调度前推的活数据
    expect(pet?.boredom).toBe(60);
    expect(pet?.energy).toBe(55);

    // report 留档
    const reportPath = join(dataDir, 'migration-pet-stats-report.json');
    expect(existsSync(reportPath)).toBe(true);
    const persisted = JSON.parse(readFileSync(reportPath, 'utf-8')) as typeof report;
    expect(entryOf(persisted, 'p1')?.status).toBe('migrated');
  });

  it('幂等：重跑 already-migrated，不重复改值', async () => {
    await getOrCreateTenant(dataDir, 't1');
    await addPet('p1', 't1');
    writeState('t1', { mood: 'lazy', temper: 40 });

    await migratePetStats(dataDir);
    // 迁移后 state.json 改值，重跑不得跟随（幂等标记在 DB）
    writeState('t1', { mood: 'emo', temper: 99 });
    const report2 = await migratePetStats(dataDir);

    expect(entryOf(report2, 'p1')?.status).toBe('already-migrated');
    const db = await getDb(dataDir);
    const pet = await db.select().from(pets).where(eq(pets.id, 'p1')).get();
    expect(pet?.mood).toBe('lazy');
    expect(pet?.temper).toBe(40);
  });

  it('无 state.json → no-state-file；形状非法 → invalid-source', async () => {
    await getOrCreateTenant(dataDir, 't1');
    await getOrCreateTenant(dataDir, 't2');
    await addPet('p-none', 't1'); // 无 state.json
    await addPet('p-bad', 't2');
    writeState('t2', { mood: 'not-a-mood', temper: 'x' });

    const report = await migratePetStats(dataDir);
    expect(entryOf(report, 'p-none')?.status).toBe('no-state-file');
    expect(entryOf(report, 'p-bad')?.status).toBe('invalid-source');

    const db = await getDb(dataDir);
    for (const id of ['p-none', 'p-bad']) {
      const pet = await db.select().from(pets).where(eq(pets.id, id)).get();
      expect(pet?.mood).toBeNull();
    }
  });
});
