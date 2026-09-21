/**
 * pushSubscriptions / vapidKeys 表访问（基础设施层）
 *
 * 订阅行的归属与幂等语义在 upsert 内单语句完成；VAPID 私钥信封加密
 * 细节同在此收口（无明文 secrets 落盘）。
 */

import { and, eq, sql } from 'drizzle-orm';
import webpush from 'web-push';
import { getDb, type ControlDb } from '../db/client.js';
import { pushSubscriptions, vapidKeys } from '../db/schema.js';
import { decryptWith, encryptWith } from '../secrets/tenant-secrets.js';
import { loadMasterKey } from '../secrets/master-key.js';

/** VAPID 单例行 id（首用时生成整对，跨重启稳定） */
const VAPID_ROW_ID = 1;

/** VAPID privateKey 信封加密前缀（master.key AES-256-GCM；AAD 防跨用途复用） */
const VAPID_ENC_PREFIX = 'enc:v1:';
const VAPID_AAD = Buffer.from('vapid:private-key');

/**
 * 取（或生成）VAPID 密钥对。
 * env 显式提供时优先（运维可预生成/轮换）；否则首用时生成、privateKey 经
 * master.key 信封加密存 DB（无明文 secrets 落盘）。旧明文行首次读取自动迁移。
 */
export async function getVapidKeys(dataDir: string): Promise<{ publicKey: string; privateKey: string }> {
  const db = await getDb(dataDir);

  const envPub = process.env.CP_VAPID_PUBLIC_KEY;
  const envPriv = process.env.CP_VAPID_PRIVATE_KEY;
  if (envPub && envPriv) {
    return { publicKey: envPub, privateKey: envPriv };
  }

  const existing = await db.select().from(vapidKeys).where(eq(vapidKeys.id, VAPID_ROW_ID)).get();
  if (existing) {
    const stored = existing.privateKey;
    if (stored.startsWith(VAPID_ENC_PREFIX)) {
      const mk = await loadMasterKey(dataDir);
      return {
        publicKey: existing.publicKey,
        privateKey: decryptWith(mk, stored.slice(VAPID_ENC_PREFIX.length), VAPID_AAD),
      };
    }
    // 旧明文行：迁移为加密存储，读取不暴露明文路径
    const mk = await loadMasterKey(dataDir);
    const packed = VAPID_ENC_PREFIX + encryptWith(mk, stored, VAPID_AAD);
    await db
      .update(vapidKeys)
      .set({ privateKey: packed })
      .where(eq(vapidKeys.id, VAPID_ROW_ID))
      .run();
    return { publicKey: existing.publicKey, privateKey: stored };
  }

  const generated = webpush.generateVAPIDKeys();
  const mk = await loadMasterKey(dataDir);
  await db
    .insert(vapidKeys)
    .values({
      id: VAPID_ROW_ID,
      publicKey: generated.publicKey,
      privateKey: VAPID_ENC_PREFIX + encryptWith(mk, generated.privateKey, VAPID_AAD),
    })
    .onConflictDoNothing({ target: vapidKeys.id })
    .run();
  const row = await db.select().from(vapidKeys).where(eq(vapidKeys.id, VAPID_ROW_ID)).get();
  if (!row) {
    throw new Error('VAPID 密钥生成失败'); // 理论不可达：插入后必可读
  }
  const mk2 = await loadMasterKey(dataDir);
  return {
    publicKey: row.publicKey,
    privateKey: decryptWith(mk2, row.privateKey.slice(VAPID_ENC_PREFIX.length), VAPID_AAD),
  };
}

export interface SubscriptionUpsert {
  tenantId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  now: number;
}

/**
 * 订阅登记：单语句 upsert（SELECT-then-INSERT 并发双击会撞唯一约束 500）。
 * lastNotifiedAt 语义：新订阅/换租户重置为 now——只通知订阅后的新内容，首次
 * 事件不追发历史；同租户续订保留。endpoint 是 Web Push 的 capability URL
 * （高熵机密），归属转移即「设备换号」——持有 endpoint 即视为设备本人在操作。
 */
export async function upsertSubscription(db: ControlDb, sub: SubscriptionUpsert): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({
      id: crypto.randomUUID(),
      tenantId: sub.tenantId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      lastNotifiedAt: sub.now,
      createdAt: sub.now,
      updatedAt: sub.now,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        tenantId: sub.tenantId,
        p256dh: sub.p256dh,
        auth: sub.auth,
        updatedAt: sub.now,
        lastNotifiedAt: sql`CASE WHEN push_subscriptions.tenant_id = ${sub.tenantId} THEN push_subscriptions.last_notified_at ELSE ${sub.now} END`,
      },
    })
    .run();
}

/** 退订：只删本租户的行（他租户 endpoint 存在与与否不可探测），返回是否删到 */
export async function deleteSubscription(
  db: ControlDb,
  tenantId: string,
  endpoint: string,
): Promise<boolean> {
  const deleted = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.tenantId, tenantId)))
    .run();
  return deleted.rowsAffected > 0;
}

export async function listSubscriptionsByTenant(db: ControlDb, tenantId: string) {
  return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.tenantId, tenantId)).all();
}
