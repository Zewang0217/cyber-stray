/**
 * 邀请 repo（#301）——内测一次性链接凭证的存储与状态机
 *
 * 决议（#273，2026-09-24 拍板）：raw token 不落库（只存 sha256，raw 仅在
 * 生成响应里出现一次）；一次性（consumed_at 用后即焚）+ 可吊销（revoked_at）
 * + 内测不设过期；consumed_tenant_id 记归因（invitedBy）。
 *
 * 消费是条件更新（WHERE 未吊销且未消费）：并发抢同一条邀请只有一人成功，
 * 「一次性」语义由 DB 原子性保证，不靠先查后写的竞态窗口。
 */

import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { invites } from '../db/schema.js';

export interface InviteCreated {
  id: string;
  /** raw token：仅在创建响应里返回一次，服务端不存 */
  token: string;
  label: string | null;
  createdBy: string;
  createdAt: number;
}

export interface InvitePublic {
  id: string;
  label: string | null;
  createdBy: string;
  createdAt: number;
  revokedAt: number | null;
  consumedAt: number | null;
  consumedTenantId: string | null;
}

/** 128bit 随机 token（hex）；链接形态 `?invite=<token>` */
export function generateInviteToken(): string {
  return randomBytes(16).toString('hex');
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 生成邀请：返回 raw token 一次，此后服务端只有哈希 */
export async function createInvite(
  dataDir: string,
  input: { createdBy: string; label?: string },
): Promise<InviteCreated> {
  const db = await getDb(dataDir);
  const id = randomUUID();
  const token = generateInviteToken();
  const createdAt = Date.now();
  await db.insert(invites).values({
    id,
    tokenHash: hashInviteToken(token),
    label: input.label ?? null,
    createdBy: input.createdBy,
    createdAt,
  });
  return { id, token, label: input.label ?? null, createdBy: input.createdBy, createdAt };
}

/** 全量列表（管理页）；脱敏 tokenHash */
export async function listInvites(dataDir: string): Promise<InvitePublic[]> {
  const db = await getDb(dataDir);
  const rows = await db.select().from(invites).orderBy(desc(invites.createdAt));
  return rows.map(({ tokenHash: _tokenHash, ...rest }) => rest);
}

/** 吊销：已消费/已吊销的返回 false（无可吊销状态） */
export async function revokeInvite(dataDir: string, id: string): Promise<boolean> {
  const db = await getDb(dataDir);
  const result = await db
    .update(invites)
    .set({ revokedAt: Date.now() })
    .where(and(eq(invites.id, id), isNull(invites.revokedAt), isNull(invites.consumedAt)))
    .run();
  return result.rowsAffected > 0;
}

/** 校验（不消费）：存在且未吊销未消费 = 有效；否则 null（无行 undefined 归一为 null） */
export async function validateInvite(dataDir: string, token: string) {
  const db = await getDb(dataDir);
  const row = await db
    .select()
    .from(invites)
    .where(and(eq(invites.tokenHash, hashInviteToken(token)), isNull(invites.revokedAt), isNull(invites.consumedAt)))
    .get();
  return row ?? null;
}

/** 消费（条件更新）：并发抢同一条邀请只有一人成功 */
export async function consumeInvite(dataDir: string, id: string, tenantId: string): Promise<boolean> {
  const db = await getDb(dataDir);
  const result = await db
    .update(invites)
    .set({ consumedAt: Date.now(), consumedTenantId: tenantId })
    .where(and(eq(invites.id, id), isNull(invites.revokedAt), isNull(invites.consumedAt)))
    .run();
  return result.rowsAffected > 0;
}
