/**
 * 邀请申请仓储：invite_applications 表的读写边界。
 *
 * raw inviteUrl（含 token）落库是有意取舍：申请不收集邮箱，没有第二个
 * 投递通道，「凭申请号 + 查询码随时换链接」是产品承诺，服务端必须持有
 * 可重建链接的信息。泄露面 = 已批准未消费的单人码（用完即止，admin 可
 * 经 inviteId 吊销兜底）；与 invites.tokenHash「raw 只出现一次」的差异
 * 已在字段注释声明。
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { inviteApplications } from '../db/schema.js';

export interface ApplicationRecord {
  id: string;
  publicId: string;
  secretHash: string;
  nickname: string | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
  inviteId: string | null;
  inviteUrl: string | null;
}

export interface NewApplication {
  nickname: string | null;
  reason: string;
}

/** 新申请的凭据对：raw secret 只在此出现一次（落库的是 sha256） */
export interface ApplicationCredentials {
  record: ApplicationRecord;
  secret: string;
}

export function generateApplicationSecret(): string {
  return randomBytes(16).toString('hex');
}

export function generateApplicationPublicId(): string {
  return randomBytes(6).toString('hex');
}

export function hashApplicationSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export async function createApplication(dataDir: string, input: NewApplication): Promise<ApplicationCredentials> {
  const db = await getDb(dataDir);
  const secret = generateApplicationSecret();
  const record: ApplicationRecord = {
    id: randomUUID(),
    publicId: generateApplicationPublicId(),
    secretHash: hashApplicationSecret(secret),
    nickname: input.nickname,
    reason: input.reason,
    status: 'pending',
    createdAt: Date.now(),
    decidedAt: null,
    decidedBy: null,
    inviteId: null,
    inviteUrl: null,
  };
  await db.insert(inviteApplications).values(record);
  return { record, secret };
}

/** 凭据对查询：申请号 + sha256(查询码) 双命中才返回记录 */
export async function findApplicationByCredentials(
  dataDir: string,
  publicId: string,
  secret: string,
): Promise<ApplicationRecord | null> {
  const db = await getDb(dataDir);
  const rows = await db.select().from(inviteApplications)
    .where(eq(inviteApplications.publicId, publicId))
    .limit(1);
  const row = rows[0];
  if (!row || row.secretHash !== hashApplicationSecret(secret)) return null;
  return row as ApplicationRecord;
}

export async function findApplicationById(dataDir: string, id: string): Promise<ApplicationRecord | null> {
  const db = await getDb(dataDir);
  const rows = await db.select().from(inviteApplications)
    .where(eq(inviteApplications.id, id))
    .limit(1);
  return (rows[0] as ApplicationRecord | undefined) ?? null;
}

/** admin 列表：新申请在前 */
export async function listApplications(dataDir: string): Promise<ApplicationRecord[]> {
  const db = await getDb(dataDir);
  const rows = await db.select().from(inviteApplications)
    .orderBy(desc(inviteApplications.createdAt))
    .limit(200);
  return rows as ApplicationRecord[];
}

/** 落定（approve/reject 共用）：只有 pending 可落定，重复落定返回 null */
export async function decideApplication(
  dataDir: string,
  id: string,
  decision: { status: 'approved' | 'rejected'; decidedBy: string; inviteId?: string; inviteUrl?: string },
): Promise<ApplicationRecord | null> {
  const db = await getDb(dataDir);
  const rows = await db.update(inviteApplications)
    .set({
      status: decision.status,
      decidedAt: Date.now(),
      decidedBy: decision.decidedBy,
      ...(decision.inviteId ? { inviteId: decision.inviteId } : {}),
      ...(decision.inviteUrl ? { inviteUrl: decision.inviteUrl } : {}),
    })
    .where(and(eq(inviteApplications.id, id), eq(inviteApplications.status, 'pending')))
    .returning();
  return (rows[0] as ApplicationRecord | undefined) ?? null;
}
