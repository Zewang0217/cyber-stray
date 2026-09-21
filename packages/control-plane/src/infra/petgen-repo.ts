/**
 * petGenTasks 表访问（基础设施层）
 *
 * 任务状态机由 PetGenProcessor tick 推进；本模块只做行读写，
 * 不做状态转移判定（那在 services/petgen-service）。
 */

import { and, desc, eq } from 'drizzle-orm';
import type { ControlDb } from '../db/client.js';
import { petGenTasks, type PetGenTask } from '../db/schema.js';

export async function listTasksByTenant(db: ControlDb, tenantId: string) {
  return db
    .select()
    .from(petGenTasks)
    .where(eq(petGenTasks.tenantId, tenantId))
    .orderBy(desc(petGenTasks.createdAt))
    .all();
}

/** 租户隔离查询：他人任务一律不可见（404 语义） */
export async function findTaskByIdAndTenant(db: ControlDb, id: string, tenantId: string) {
  return db
    .select()
    .from(petGenTasks)
    .where(and(eq(petGenTasks.id, id), eq(petGenTasks.tenantId, tenantId)))
    .get();
}

export async function insertTask(db: ControlDb, task: PetGenTask) {
  await db.insert(petGenTasks).values(task).run();
}

export async function updateTask(
  db: ControlDb,
  id: string,
  patch: Partial<PetGenTask>,
): Promise<void> {
  await db.update(petGenTasks).set(patch).where(eq(petGenTasks.id, id)).run();
}
