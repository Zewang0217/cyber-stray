/**
 * 一次性幂等迁移：存量 tenants/<id>/state.json 心情/脾气 → CP pets 表（#216 / ADR-0013）
 *
 * 只回填 pets 缺失的 mood/temper 两列；energy/boredom **不动**——pets 里是
 * 调度前推+游荡写回的活数据，state.json 里是停摆的陈旧副本，回填会当场
 * 复现 #173（陈旧 energy=0 卡死门禁）。决策记录见 #216 验收。
 *
 * 幂等标记 = pets.mood IS NULL（回填过即非 NULL，重跑跳过）。
 * report 落 <dataDir>/migration-pet-stats-report.json（含每租户状态，可重跑）。
 *
 * 用法：bun packages/control-plane/src/migration/migrate-pet-stats.ts <dataDir>
 * 迁移是**部署顺序的一部分**：CP 升级含本票代码后、恢复调度前执行一次。
 */

import { readFile, writeFile, rename } from 'fs/promises';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import { isPetMood, type PetMood } from '@cyber-stray/shared/pet-stats';
import { getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { pets } from '../db/schema.js';
import { tenantDataDir } from '../tenant.js';

export type PetStatsMigrationStatus =
  | 'migrated'
  | 'already-migrated'
  | 'no-state-file'
  | 'invalid-source';

export interface PetStatsMigrationEntry {
  petId: string;
  tenantId: string;
  status: PetStatsMigrationStatus;
  /** 回填的值（仅 migrated 时存在） */
  mood?: PetMood;
  temper?: number;
}

export interface PetStatsMigrationReport {
  ranAt: string;
  entries: PetStatsMigrationEntry[];
}

const REPORT_FILE = 'migration-pet-stats-report.json';

/** 读租户 state.json 的心情/脾气；文件缺失返回 null（合法空态）；值非法抛错（禁兜底） */
async function readTenantMoodTemper(
  tenantDir: string,
): Promise<{ mood: PetMood; temper: number } | null> {
  let raw: string;
  try {
    raw = await readFile(join(tenantDir, 'state.json'), 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const parsed = JSON.parse(raw) as { mood?: unknown; temper?: unknown };
  const temper: unknown = parsed.temper;
  if (
    !isPetMood(parsed.mood) ||
    typeof temper !== 'number' || !Number.isFinite(temper) ||
    temper < 0 || temper > 100
  ) {
    throw new Error(`state.json 心情/脾气形状非法: mood=${JSON.stringify(parsed.mood)} temper=${JSON.stringify(parsed.temper)}`);
  }
  return { mood: parsed.mood, temper };
}

/**
 * 执行迁移（幂等，可重跑）。返回 report；不抛业务错——单租户失败记入
 * report（invalid-source），让持机人看报告决策，不静默也不中断其他租户。
 */
export async function migratePetStats(dataDir: string): Promise<PetStatsMigrationReport> {
  await runMigrations(dataDir);
  const db = await getDb(dataDir);
  const rows = await db.select().from(pets).all();

  const entries: PetStatsMigrationEntry[] = [];
  for (const pet of rows) {
    if (pet.mood !== null && pet.temper !== null) {
      entries.push({ petId: pet.id, tenantId: pet.tenantId, status: 'already-migrated' });
      continue;
    }
    let stats: { mood: PetMood; temper: number } | null;
    try {
      stats = await readTenantMoodTemper(tenantDataDir(dataDir, pet.tenantId));
    } catch (error) {
      console.error(`[migrate-pet-stats] ${pet.tenantId}:`, error instanceof Error ? error.message : error);
      entries.push({ petId: pet.id, tenantId: pet.tenantId, status: 'invalid-source' });
      continue;
    }
    if (stats === null) {
      entries.push({ petId: pet.id, tenantId: pet.tenantId, status: 'no-state-file' });
      continue;
    }
    await db
      .update(pets)
      .set({ mood: stats.mood, temper: stats.temper, updatedAt: Date.now() })
      .where(eq(pets.id, pet.id))
      .run();
    entries.push({
      petId: pet.id,
      tenantId: pet.tenantId,
      status: 'migrated',
      mood: stats.mood,
      temper: stats.temper,
    });
  }

  const report: PetStatsMigrationReport = { ranAt: new Date().toISOString(), entries };
  const reportPath = join(dataDir, REPORT_FILE);
  const tmpPath = `${reportPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(report, null, 2), 'utf-8');
  await rename(tmpPath, reportPath);
  return report;
}

const isDirectRun = process.argv[1]?.endsWith('migrate-pet-stats.ts');

if (isDirectRun) {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('用法: bun src/migration/migrate-pet-stats.ts <control-plane-data-dir>');
    process.exit(2);
  }
  migratePetStats(dataDir)
    .then((report) => {
      const migrated = report.entries.filter((e) => e.status === 'migrated').length;
      console.log(JSON.stringify({ ok: true, migrated, report }));
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error(
        JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
      process.exit(1);
    });
}
