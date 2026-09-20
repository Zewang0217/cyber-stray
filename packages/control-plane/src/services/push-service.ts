/**
 * PushService（应用层）——Web Push 订阅管理
 *
 * 订阅登记（endpoint 幂等，换租户重新订阅即转移归属——设备跟人走）、
 * 退订（限本租户）、首推送达状态。VAPID 密钥与订阅存储在 infra/push-repo，
 * 可通知内容判定复用 push-gateway 的单一实现。
 */

import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { getVapidKeys, listSubscriptionsByTenant } from '../infra/push-repo.js';
import { deleteSubscription, upsertSubscription } from '../infra/push-repo.js';
import { latestNotifiableSpeak } from '../push/push-gateway.js';

export interface PushServiceDeps {
  config: Pick<ControlPlaneConfig, 'dataDir'>;
}

export interface SubscribeInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function createPushService({ config }: PushServiceDeps) {
  /** 浏览器订阅前拉取应用服务器公钥（公开，无泄漏风险） */
  async function getPublicKey() {
    const keys = await getVapidKeys(config.dataDir);
    return { publicKey: keys.publicKey };
  }

  async function subscribe(tenantId: string, input: SubscribeInput) {
    await upsertSubscription(await getDb(config.dataDir), {
      tenantId,
      ...input,
      now: Date.now(),
    });
    return { upserted: true };
  }

  /** 按 endpoint 退订（只删本租户的行）；没删到 = 订阅不存在 */
  async function unsubscribe(tenantId: string, endpoint: string) {
    const deleted = await deleteSubscription(await getDb(config.dataDir), tenantId, endpoint);
    return deleted ? { deleted: true } : null;
  }

  /** 首推送达标记：pendingDelivery = 有订阅、存在可通知内容、且比所有设备的
   * 已通知位都新（谁都没收到过）——web 据此展示「第一张明信片在路上」文案 */
  async function getStatus(tenantId: string) {
    const db = await getDb(config.dataDir);
    const subs = await listSubscriptionsByTenant(db, tenantId);
    if (subs.length === 0) {
      return { subscribed: false, pendingDelivery: false, latestNotifiableAt: null };
    }

    const notifiedCeiling = Math.max(...subs.map((s) => s.lastNotifiedAt ?? 0));
    const latest = await latestNotifiableSpeak(config.dataDir, tenantId);
    const latestAt = latest ? String(latest.timestamp) : null;
    const contentAt = latestAt ? new Date(latestAt).getTime() : NaN;
    const pendingDelivery = !Number.isNaN(contentAt) && contentAt > notifiedCeiling;
    return { subscribed: true, pendingDelivery, latestNotifiableAt: latestAt };
  }

  return { getPublicKey, subscribe, unsubscribe, getStatus };
}

export type PushService = ReturnType<typeof createPushService>;
