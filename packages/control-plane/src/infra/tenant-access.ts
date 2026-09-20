/**
 * 租户相关的存储访问（基础设施层）
 *
 * 覆盖「会话用户 × 租户」关系（鉴权用）与账号层字段（tenants.plan）。
 * 路由层不得直接 import db/，统一经本模块访问；待 requireTenant 中间件
 * 落地后鉴权查询收敛为单一调用方。
 */

import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { tenants, userTenants } from '../db/schema.js';

/** 会话用户与租户的关系行；不存在返回 undefined */
export async function findUserTenantRelation(dataDir: string, userId: string, tenantId: string) {
  const db = await getDb(dataDir);
  return db
    .select()
    .from(userTenants)
    .where(
      and(eq(userTenants.userId, userId), eq(userTenants.tenantId, tenantId)),
    )
    .get();
}

/** 套餐存在账号层（tenants.plan）；无行返回 null，回退策略由调用方决定 */
export async function findTenantPlan(dataDir: string, tenantId: string): Promise<string | null> {
  const db = await getDb(dataDir);
  const row = await db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
  return row?.plan ?? null;
}
