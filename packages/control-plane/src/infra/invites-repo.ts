/** 邀请存储：容量条件更新与用户归因在同一事务内，拒绝重复用户及超额消费。 */
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { and, eq, isNull, desc, lt, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { invites, inviteRedemptions } from '../db/schema.js';
import { INVITE_TOKEN_BYTES, MAX_INVITE_USES, CreateInviteSchema, ExpandInviteSchema, isInviteToken, type InvitePublic } from '@cyber-stray/shared/invite';

export interface InviteCreated {
  id: string;
  /** raw token：仅在创建响应里返回一次，服务端不存 */
  token: string;
  label: string | null;
  createdBy: string;
  createdAt: number;
  maxUses: number;
}

export type { InvitePublic } from '@cyber-stray/shared/invite';

/** 128bit 随机 token（hex）；链接形态 `?invite=<token>` */
export function generateInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString('hex');
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 生成邀请：返回 raw token 一次，此后服务端只有哈希 */
export async function createInvite(
  dataDir: string,
  input: { createdBy: string; label?: string; maxUses?: number },
): Promise<InviteCreated> {
  const { maxUses, label } = CreateInviteSchema.parse({ label: input.label, maxUses: input.maxUses });
  const db = await getDb(dataDir);
  const id = randomUUID();
  const token = generateInviteToken();
  const createdAt = Date.now();
  await db.insert(invites).values({
    id,
    tokenHash: hashInviteToken(token),
    label: label ?? null,
    createdBy: input.createdBy,
    createdAt, maxUses,
  });
  return { id, token, label: label ?? null, createdBy: input.createdBy, createdAt, maxUses };
}

/** 全量列表（管理页）；脱敏 tokenHash */
export async function listInvites(dataDir: string): Promise<InvitePublic[]> {
  const db = await getDb(dataDir);
  const rows = await db.select().from(invites).orderBy(desc(invites.createdAt));
  return rows.map(({ tokenHash: _tokenHash, ...rest }) => rest);
}

/** 吊销可用或已用满的邀请，已吊销不再更改。 */
export async function revokeInvite(dataDir: string, id: string): Promise<boolean> {
  const db = await getDb(dataDir);
  const result = await db
    .update(invites)
    .set({ revokedAt: Date.now() })
    .where(and(eq(invites.id, id), isNull(invites.revokedAt)))
    .run();
  return result.rowsAffected > 0;
}

/** 校验不占名额；消费事务仍需原子检查容量和吊销状态。 */
export async function validateInvite(dataDir: string, token: string) {
  if (!isInviteToken(token)) return null;
  const db = await getDb(dataDir);
  const row = await db
    .select()
    .from(invites)
    .where(and(eq(invites.tokenHash, hashInviteToken(token)), isNull(invites.revokedAt), lt(invites.usedCount, invites.maxUses)))
    .get();
  return row ?? null;
}

/** 增加已发出链接的容量：原 token/链接不变，吊销状态不可恢复。 */
export async function expandInvite(dataDir: string, id: string, additionalUses: number): Promise<InvitePublic | null> {
  ExpandInviteSchema.parse({ additionalUses });
  const db = await getDb(dataDir);
  const rows = await db.update(invites).set({ maxUses: sql`${invites.maxUses} + ${additionalUses}` })
    .where(and(eq(invites.id, id), isNull(invites.revokedAt),
      sql`${invites.maxUses} + ${additionalUses} <= ${MAX_INVITE_USES}`)).returning();
  if (!rows[0]) return null;
  const { tokenHash: _tokenHash, ...row } = rows[0];
  return row;
}

/**
 * SQLite 原子 batch 先插入归因，再仅在插入成功时计数（changes()）。
 * 避免交互事务中的 await 持锁导致本地 libsql 并发请求 SQLITE_BUSY；
 * batch 同一事务内没有其他语句插入，失败全部回滚，不吞数据库异常。
 */
export async function consumeInvite(dataDir: string, id: string, tenantId: string): Promise<boolean> {
  const db = await getDb(dataDir);
  const now = Date.now();
  const insert = db.insert(inviteRedemptions).select(db.select({
    tenantId: sql<string>`${tenantId}`.as("tenant_id"), inviteId: invites.id, redeemedAt: sql<number>`${now}`.as("redeemed_at"),
  }).from(invites).where(and(eq(invites.id, id), isNull(invites.revokedAt), lt(invites.usedCount, invites.maxUses))))
    .onConflictDoNothing();
  const increment = db.update(invites).set({
    usedCount: sql`${invites.usedCount} + 1`,
    consumedAt: sql`coalesce(${invites.consumedAt}, ${now})`,
    consumedTenantId: sql`coalesce(${invites.consumedTenantId}, ${tenantId})`,
  }).where(and(eq(invites.id, id), sql`changes() = 1`)).returning({ id: invites.id });
  const [, rows] = await db.batch([insert, increment]);
  return rows.length === 1;
}
