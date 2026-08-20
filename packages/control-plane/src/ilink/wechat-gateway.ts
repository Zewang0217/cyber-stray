/**
 * 微信主动推送网关（#97）：worker_succeeded → 最新可通知 speak → 微信。
 *
 * 通道限额 = min(套餐每日上限, 8 条/天)（官方 10 条/24h 会话留 20% 余量）；
 * 超限 → 跳过微信投递——飞书/TG/PWA 各自独立投递，天然"降级其他已绑通道"
 * （ADR-0003：微信优先，超限降级，不拦截其他通道）。
 *
 * 只推 active 状态租户（paired/expired 不推内容——ADR：激活前只发打招呼）；
 * 主动推送用缓存的最近 context_token（主人最近一条消息的 token；短命轮换，
 * 恒用最新）。发送遇会话失效 → 标记 expired（主人重新打招呼激活）。
 */

import { getDb } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { EventBus, TenantEvent } from '../events/bus.js';
import { latestNotifiableSpeak } from '../push/push-gateway.js';
import {
  claimPushQuota,
  getBinding,
  isWechatSessionExpired,
  readBotToken,
  updateBinding,
  wechatPushLimit,
} from './bindings.js';
import { readContextToken } from './chat-history.js';
import { IlinkSessionInvalidError, type IlinkClient } from './client.js';

export interface WechatPushGatewayDeps {
  dataDir: string;
  bus: EventBus;
  /** 按 (baseUrl, botToken) 建客户端（测试注入 mock） */
  clientFactory: (baseUrl: string, botToken: string) => IlinkClient;
  now?: () => number;
  /** 今日日期串（测试注入固定值；默认本地 YYYY-MM-DD） */
  todayFn?: () => string;
}

/** 分发结果（测试断言用） */
export interface WechatDispatchResult {
  skipped: boolean;
  reason?:
    | 'no_binding'
    | 'not_active'
    | 'session_expired'
    | 'no_content'
    | 'quota_exhausted'
    | 'no_token';
  sent?: boolean;
}

export interface WechatPushGateway {
  /** 挂到事件总线（index.ts 调用；返回卸载函数） */
  attach: () => () => void;
  /** 对一次事件尝试微信投递（测试直接驱动） */
  dispatch: (event: TenantEvent) => Promise<WechatDispatchResult>;
  /** 等所有在飞分发落定（事件驱动测试/优雅关停用，不猜时长） */
  drain: () => Promise<void>;
}

export function createWechatPushGateway(deps: WechatPushGatewayDeps): WechatPushGateway {
  const { dataDir, bus } = deps;
  const nowMs = deps.now ?? Date.now;
  const today = deps.todayFn ?? defaultToday;
  const inflight = new Set<Promise<unknown>>();

  async function dispatch(event: TenantEvent): Promise<WechatDispatchResult> {
    if (event.type !== 'worker_succeeded') return { skipped: true, reason: 'no_binding' };

    const db = await getDb(dataDir);
    const binding = await getBinding(db, event.tenantId);
    if (!binding) return { skipped: true, reason: 'no_binding' };
    if (binding.status !== 'active') return { skipped: true, reason: 'not_active' };
    if (isWechatSessionExpired(binding, nowMs())) {
      await updateBinding(db, event.tenantId, { status: 'expired' });
      return { skipped: true, reason: 'session_expired' };
    }

    const latest = await latestNotifiableSpeak(dataDir, event.tenantId);
    if (!latest || typeof latest.content !== 'string' || !latest.content.trim()) {
      return { skipped: true, reason: 'no_content' };
    }

    const tenant = await db.select().from(tenants).where(eq(tenants.id, event.tenantId)).get();
    const limit = wechatPushLimit(tenant?.plan ?? 'free');
    const claimed = await claimPushQuota(db, event.tenantId, limit, today());
    if (!claimed) {
      // 额度用尽：降级其他已绑通道（飞书/TG/PWA 独立投递，无需此处转发）
      return { skipped: true, reason: 'quota_exhausted' };
    }

    const token = await readBotToken(dataDir, event.tenantId);
    if (!token) {
      await updateBinding(db, event.tenantId, { lastError: '缺少 ilink_bot_token' });
      return { skipped: true, reason: 'no_token' };
    }
    const contextToken = await readContextToken(dataDir, event.tenantId, binding.ilinkUserId);
    if (!contextToken) {
      // 理论不发生（active 必有入站消息），防御性跳过
      return { skipped: true, reason: 'no_token' };
    }

    const client = deps.clientFactory(binding.baseUrl, token);
    try {
      await client.sendTextChunked(binding.ilinkUserId, latest.content, { contextToken });
      return { skipped: false, sent: true };
    } catch (error) {
      if (error instanceof IlinkSessionInvalidError) {
        await updateBinding(db, event.tenantId, {
          status: 'expired',
          lastError: `推送会话失效（${error.message}）`,
        });
      } else {
        await updateBinding(db, event.tenantId, {
          lastError: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  }

  return {
    attach: () => {
      const handler = (event: TenantEvent) => {
        const task = dispatch(event).catch((error: unknown) => {
          console.error(
            '[wechat-gateway] 分发失败：',
            error instanceof Error ? error.message : error,
          );
        });
        inflight.add(task);
        void task.finally(() => inflight.delete(task));
      };
      return bus.subscribeAll(handler);
    },
    dispatch,
    drain: async () => {
      // 快照当前在飞分发并等待（不阻塞新事件）
      const pending = [...inflight];
      if (pending.length > 0) {
        await Promise.allSettled(pending);
      }
    },
  };
}

function defaultToday(): string {
  return new Date().toISOString().slice(0, 10);
}
