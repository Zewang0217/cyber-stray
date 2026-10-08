/**
 * admins 表访问（基础设施层）
 *
 * 管理员 RBAC 的存储面：身份在 Casdoor（谁可登录），资源权限（能看全部
 * 租户数据）在控制面 DB 管理——放 Casdoor 会与身份耦合。env 白名单仅作
 * 首启引导。dataDir 入参（内部 getDb），路由与应用层免 import db。
 */

import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { admins } from '../db/schema.js';

/** 管理员权限统一来源：环境引导名单与持久化 RBAC，不根据用户名推断。 */
export async function isAdminSub(dataDir: string, sub: string, bootstrapSubs: readonly string[]): Promise<boolean> {
  return bootstrapSubs.includes(sub) || Boolean(await findAdminBySub(dataDir, sub));
}

export async function findAdminBySub(dataDir: string, sub: string) {
  const db = await getDb(dataDir);
  return db.select().from(admins).where(eq(admins.sub, sub)).get();
}

export async function listAdmins(dataDir: string) {
  const db = await getDb(dataDir);
  return db.select().from(admins).all();
}

export async function insertAdmin(dataDir: string, sub: string, grantedBy: string) {
  const db = await getDb(dataDir);
  return db.insert(admins).values({ sub, grantedBy }).onConflictDoNothing({ target: admins.sub }).run();
}

export async function deleteAdminBySub(dataDir: string, sub: string) {
  const db = await getDb(dataDir);
  return db.delete(admins).where(eq(admins.sub, sub)).run();
}
