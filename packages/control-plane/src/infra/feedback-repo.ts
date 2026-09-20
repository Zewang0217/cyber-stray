/**
 * feedback 相关的 pets/tenants 表访问（基础设施层）
 *
 * 只做存储读写，不做业务判定——守卫在 domain/，编排在 services/。
 * drizzle 调用收敛于此，`db.update` 不得出现在路由与应用层。
 */

import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { Catchphrase } from '@cyber-stray/shared';
import type { PetMood } from '@cyber-stray/shared/pet-stats';
import type { ControlDb } from '../db/client.js';
import { pets, tenants } from '../db/schema.js';

export async function findPetByTenant(db: ControlDb, tenantId: string) {
  return db.select().from(pets).where(eq(pets.tenantId, tenantId)).get();
}

/** 套餐存在账号层（tenants.plan）；无行返回 null，回退策略由调用方决定 */
export async function findTenantPlan(db: ControlDb, tenantId: string): Promise<string | null> {
  const row = await db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
  return row?.plan ?? null;
}

/** worker statsUpdated 落 pets（调用方已过 domain 守卫；mood 缺省 = 不更新心情） */
export async function updatePetStats(
  db: ControlDb,
  tenantId: string,
  update: { mood?: PetMood; temper: number },
): Promise<void> {
  await db
    .update(pets)
    .set({
      ...(update.mood ? { mood: update.mood } : {}),
      temper: Math.round(update.temper),
      updatedAt: Date.now(),
    })
    .where(eq(pets.tenantId, tenantId))
    .run();
}

/** 口头禅写回 pets（DB 唯一写者是 CP） */
export async function updateCatchphrases(
  db: ControlDb,
  tenantId: string,
  catchphrases: Catchphrase[],
): Promise<void> {
  await db
    .update(pets)
    .set({ catchphrases: JSON.stringify(catchphrases), updatedAt: Date.now() })
    .where(eq(pets.tenantId, tenantId))
    .run();
}

/**
 * boost 额度原子占位：间隔内已占 → 0 行受影响返回 false。
 * 条件更新一次到位，不用 check-then-write——那会横跨 spawn 开并发窗口，双击可绕过额度。
 */
export async function claimBoostQuota(
  db: ControlDb,
  tenantId: string,
  intervalMs: number,
  now: number,
): Promise<boolean> {
  const cutoff = now - intervalMs;
  const claimed = await db
    .update(pets)
    .set({ lastBoostAt: now })
    .where(
      and(
        eq(pets.tenantId, tenantId),
        or(isNull(pets.lastBoostAt), lt(pets.lastBoostAt, cutoff)),
      ),
    )
    .run();
  return claimed.rowsAffected > 0;
}

/** 回滚占位（worker 失败不消耗额度），恢复占位前的旧值 */
export async function rollbackBoostQuota(
  db: ControlDb,
  tenantId: string,
  priorValue: number | null,
): Promise<void> {
  await db.update(pets).set({ lastBoostAt: priorValue }).where(eq(pets.tenantId, tenantId)).run();
}
