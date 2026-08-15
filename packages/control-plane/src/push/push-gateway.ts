/**
 * push-gateway — Web Push 分发器（S10，#77）
 *
 * 挂在事件总线上（subscribeAll）：worker_succeeded（一轮游荡完成，可能
 * 产生了新推送）→ 读该租户 speaks 历史最新一条 pushed 记录 → 向该租户
 * 全部订阅设备发系统级通知（App 关闭也能收）。
 *
 * 去重：每设备 lastNotifiedAt——只有内容时间戳晚于上次已通知时间才发
 * （多设备各自记账；同轮多事件只发最新一条）。
 *
 * 失效清理：404/410（端点注销）→ 删订阅行；其他错误保留（下轮重试）。
 * 租户隔离：订阅按 tenantId 过滤，只发事件租户。
 */

import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import webpush from 'web-push';
import { getDb } from '../db/client.js';
import { pushSubscriptions } from '../db/schema.js';
import { tenantDataDir } from '../tenant.js';
import { getVapidKeys } from '../routes/push.js';
import type { EventBus, TenantEvent, TenantEventHandler } from '../events/bus.js';

/** 注入式发送（测试 fake）；真实实现用 web-push。keys 由调用方逐设备传入 */
export type PushSendFn = (
  endpoint: string,
  payload: unknown,
  keys: { p256dh: string; auth: string },
) => Promise<void>;

/** 真实发送：web-push.sendNotification；404/410 抛带 statusCode 的错 */
const realSend: PushSendFn = async (endpoint, payload, keys) => {
  await webpush.sendNotification(
    { endpoint, keys },
    JSON.stringify(payload),
  );
};

export interface PushGatewayDeps {
  dataDir: string;
  bus: EventBus;
  /** 注入式发送（测试）；缺省真实发送 */
  sendFn?: PushSendFn;
  /** 注入式 VAPID 读取（测试）；缺省 DB/env */
  getKeys?: () => Promise<{ publicKey: string; privateKey: string }>;
}

/** 通知载荷（Service Worker 展示） */
export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  timestamp: string;
}

/** 最新一条已推送记录（按 speaks-*.jsonl 倒序扫） */
async function latestPushedSpeak(
  dataDir: string,
  tenantId: string,
): Promise<Record<string, unknown> | null> {
  const historyDir = join(tenantDataDir(dataDir, tenantId), 'history');
  let files: string[];
  try {
    files = (await readdir(historyDir)).filter(
      (f) => f.startsWith('speaks-') && f.endsWith('.jsonl'),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  files.sort().reverse();

  for (const file of files) {
    const content = await readFile(join(historyDir, file), 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      let record: Record<string, unknown>;
      try {
        const line = lines[i];
        if (!line) continue;
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      // 可通知 = 门控放行（gated 未标记）。与外部渠道投递解耦：
      // 纯 PWA 租户（无飞书/TG）pushed 恒 false，但门控放行的内容
      // 就是它想收到的——Web Push 是默认通道而非渠道镜像（#77）
      if (record.gated !== true && typeof record.timestamp === 'string') {
        return record;
      }
    }
  }
  return null;
}

/**
 * 挂载推送分发器；返回卸载函数。
 * 事件派发异步处理（不阻塞发布方——总线是同步派发，这里自起 async 任务）。
 */
export function attachPushGateway(deps: PushGatewayDeps): () => void {
  const { dataDir, bus } = deps;
  const send = deps.sendFn ?? realSend;
  const getKeys = deps.getKeys ?? (() => getVapidKeys(dataDir));

  const handler: TenantEventHandler = (event) => {
    void dispatch(event).catch((error: unknown) => {
      console.error('[push-gateway] 分发失败：', error instanceof Error ? error.message : error);
    });
  };

  async function dispatch(event: TenantEvent): Promise<void> {
    if (event.type !== 'worker_succeeded') return;

    // 先查订阅（无订阅的租户连历史都不读）
    const db = await getDb(dataDir);
    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.tenantId, event.tenantId))
      .all();
    if (subs.length === 0) return;

    const latest = await latestPushedSpeak(dataDir, event.tenantId);
    if (!latest) return;
    const contentAt = new Date(String(latest.timestamp)).getTime();
    if (Number.isNaN(contentAt)) return;

    const payload: PushPayload = {
      title: '街溜子有新发现',
      body: typeof latest.title === 'string' && latest.title ? latest.title : '它逛到了有趣的东西',
      ...(typeof latest.url === 'string' && latest.url ? { url: latest.url } : {}),
      timestamp: String(latest.timestamp),
    };

    // VAPID 配置一次；订阅密钥每设备不同，sendNotification 逐个传
    const keys = await getKeys();
    webpush.setVapidDetails('mailto:cyber-stray@localhost', keys.publicKey, keys.privateKey);

    for (const sub of subs) {
      // 原子占坑去重（check-then-act 横跨网络发送会开并发窗口——多宠
      // 同 tick 完成时两个 dispatch 都读到旧值、同条内容发两次）：
      // 条件 UPDATE 一步完成"检查已通知 + 记账"，rowsAffected=0 即跳过
      const claimed = await db
        .update(pushSubscriptions)
        .set({ lastNotifiedAt: contentAt })
        .where(
          and(
            eq(pushSubscriptions.id, sub.id),
            or(
              isNull(pushSubscriptions.lastNotifiedAt),
              lt(pushSubscriptions.lastNotifiedAt, contentAt),
            ),
          ),
        )
        .run();
      if (claimed.rowsAffected === 0) continue;

      try {
        await send(sub.endpoint, payload, { p256dh: sub.p256dh, auth: sub.auth });
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // 端点已注销（用户清了浏览器通知/卸载）：清死订阅
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).run();
        } else {
          // 其他失败（403 VAPID 不匹配/网络等）：回滚占坑让下轮重试，
          // 并留痕——持续故障（如 VAPID 轮换后旧订阅全量 403）不能静默
          console.error(
            `[push-gateway] 发送失败（${event.tenantId}/${sub.endpoint.slice(-12)}）：`,
            error instanceof Error ? error.message : error,
          );
          await db
            .update(pushSubscriptions)
            .set({ lastNotifiedAt: sub.lastNotifiedAt })
            .where(eq(pushSubscriptions.id, sub.id))
            .run();
        }
      }
    }
  }

  return bus.subscribeAll(handler);
}
