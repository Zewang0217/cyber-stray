/**
 * pets 表访问（基础设施层）
 *
 * pets 表全部 drizzle 调用收敛于此（含 feedback 用例的心情/口头禅/额度读写），
 * `db.update` 不得出现在路由与应用层。只做存储，业务判定在 domain/ 与 services/。
 */

import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { Catchphrase } from '@cyber-stray/shared';
import type { DiaryStyleChoice } from '@cyber-stray/shared/diary';
import type { PetMood } from '@cyber-stray/shared/pet-stats';
import type { ControlDb } from '../db/client.js';
import { pets, type NewPet } from '../db/schema.js';

export async function findPetByTenant(db: ControlDb, tenantId: string) {
  return db.select().from(pets).where(eq(pets.tenantId, tenantId)).get();
}

export async function findPetsByTenant(db: ControlDb, tenantId: string) {
  return db.select().from(pets).where(eq(pets.tenantId, tenantId)).all();
}

/** 全部宠物行（管理面用；量级 = 租户数，无需分页） */
export async function listAllPets(db: ControlDb) {
  return db.select().from(pets).all();
}

/** 领养落库：tenant 唯一索引 + onConflictDoNothing（并发双 adopt 只赢一个） */
export async function insertPetAdopting(db: ControlDb, pet: NewPet) {
  return db.insert(pets).values(pet).onConflictDoNothing({ target: pets.tenantId }).run();
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

export async function updateSleepSchedule(
  db: ControlDb,
  tenantId: string,
  startHour: number,
  endHour: number,
): Promise<void> {
  await db
    .update(pets)
    .set({ sleepStart: startHour, sleepEnd: endHour })
    .where(eq(pets.tenantId, tenantId))
    .run();
}

/** 清除作息（回永不睡眠，与既有行为一致） */
export async function clearSleepSchedule(db: ControlDb, tenantId: string): Promise<void> {
  await db
    .update(pets)
    .set({ sleepStart: null, sleepEnd: null })
    .where(eq(pets.tenantId, tenantId))
    .run();
}

export async function updateDiaryStyle(
  db: ControlDb,
  tenantId: string,
  diaryStyle: DiaryStyleChoice,
): Promise<void> {
  await db.update(pets).set({ diaryStyle }).where(eq(pets.tenantId, tenantId)).run();
}

export async function updateDiaryPush(
  db: ControlDb,
  tenantId: string,
  diaryPushEnabled: boolean,
): Promise<void> {
  await db.update(pets).set({ diaryPushEnabled }).where(eq(pets.tenantId, tenantId)).run();
}

/** 暂停/恢复宠物（停用 = 关自进化） */
export async function updatePetStatus(
  db: ControlDb,
  tenantId: string,
  status: 'active' | 'paused',
): Promise<void> {
  await db.update(pets).set({ status }).where(eq(pets.tenantId, tenantId)).run();
}

/** 设置自定义推送时间窗（本地小时；Pro/BYOK 权益，判定在应用层） */
export async function updatePushWindow(
  db: ControlDb,
  tenantId: string,
  startHour: number,
  endHour: number,
): Promise<void> {
  await db
    .update(pets)
    .set({ pushWindowStart: startHour, pushWindowEnd: endHour })
    .where(eq(pets.tenantId, tenantId))
    .run();
}

/** 清除推送窗（回全天） */
export async function clearPushWindow(db: ControlDb, tenantId: string): Promise<void> {
  await db
    .update(pets)
    .set({ pushWindowStart: null, pushWindowEnd: null })
    .where(eq(pets.tenantId, tenantId))
    .run();
}
