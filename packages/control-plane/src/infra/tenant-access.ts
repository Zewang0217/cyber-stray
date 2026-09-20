/**
 * 租户关系的存储访问（基础设施层）——鉴权专用
 *
 * 查询「会话用户 × 租户」关系行，供路由的租户校验使用（无行 = 无权访问）。
 * 路由层不得直接 import db/，统一经本模块访问；待 requireTenant 中间件
 * 落地后收敛为单一调用方。
 */

import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { userTenants } from '../db/schema.js';

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
