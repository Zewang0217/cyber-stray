/**
 * 宠物 IP 生成月度配额（#94）
 *
 * 建议 2 套/月（CP_PETGEN_MONTHLY_QUOTA 可配）。计数口径：当前自然月内
 * 状态=done 的任务数（completedAt ≥ 本月 1 日）。失败任务不占配额——只有
 * 真正交付一套素材才消耗额度；用户拿到明确失败反馈后改 spec 重来不额外计费。
 *
 * 配额门控在 routes/petgen.ts 提交时拦截（超限 429 + 剩余量展示），
 * 处理器不重复校验（任务一旦创建即按队列推进）。
 */

import { and, eq } from 'drizzle-orm';
import type { ControlDb } from '../db/client.js';
import { petGenTasks } from '../db/schema.js';

/** 自然月起点（本地时区，unix ms） */
export function monthStart(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** 下月起点（配额重置时刻） */
export function nextMonthStart(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
}

/** 本月的剩余配额（limit - used；剩余 ≤0 即超限） */
export async function petGenQuota(
  db: ControlDb,
  tenantId: string,
  limit: number,
  now = Date.now(),
): Promise<{ used: number; remaining: number; limit: number }> {
  const start = monthStart(now);
  const rows = await db
    .select({ completedAt: petGenTasks.completedAt })
    .from(petGenTasks)
    .where(
      and(
        eq(petGenTasks.tenantId, tenantId),
        eq(petGenTasks.status, 'done'),
      ),
    )
    .all();
  // completedAt 可空；本月起点前完成的跨月任务不计（JS 过滤，规避 nullable 比较的类型噪音）
  const used = rows.filter((r) => r.completedAt !== null && r.completedAt >= start).length;
  return { used, remaining: Math.max(0, limit - used), limit };
}
