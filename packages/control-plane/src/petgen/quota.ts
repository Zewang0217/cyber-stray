/**
 * 宠物外观生成配额：成功交付后的滚动七天一套（8e8307c 起统一口径）。
 *
 * 计数口径：最近 7×24h 内状态=done 的任务数（completedAt 滚动窗口）。
 * 失败任务不占配额——只有真正交付一套素材才消耗额度；用户拿到明确失败
 * 反馈后改 spec 重来不额外计费。管理员（RBAC）unlimited 不受限。
 *
 * 配额门控在 routes/petgen.ts 提交时拦截（超限 429 + 剩余量展示），
 * 处理器不重复校验（任务一旦创建即按队列推进）。
 */

import { and, eq, gt, lte } from 'drizzle-orm';
import type { PetGenQuota } from '@cyber-stray/shared/petgen';
import type { ControlDb } from '../db/client.js';
import { petGenTasks } from '../db/schema.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** 滚动七天只计算成功交付；数据库过滤日期，避免扫描整个生成历史。
 * limit 可被租户配额覆盖（@cyber-stray/shared/quota；默认 1）。 */
export async function petGenWeeklyQuota(
  db: ControlDb, tenantId: string, unlimited = false, now = Date.now(), limit = 1,
): Promise<Omit<PetGenQuota, 'available'>> {
  const rows = await db.select({ completedAt: petGenTasks.completedAt }).from(petGenTasks)
    .where(and(eq(petGenTasks.tenantId, tenantId), eq(petGenTasks.status, 'done'),
      gt(petGenTasks.completedAt, now - WEEK_MS), lte(petGenTasks.completedAt, now))).all();
  const latest = rows.reduce((max, row) => Math.max(max, row.completedAt!), 0);
  return {
    period: 'rolling_week', unlimited, used: rows.length,
    limit: unlimited ? null : limit,
    remaining: unlimited ? null : Math.max(0, limit - rows.length),
    resetAt: !unlimited && rows.length ? new Date(latest + WEEK_MS).toISOString() : null,
  };
}
