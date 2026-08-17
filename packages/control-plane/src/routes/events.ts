/**
 * events 路由 — GET /api/events SSE 流（S8，#75）
 *
 * 应用内实时：宠物状态/新推送事件经进程内事件总线（调度器发布）推给
 * 该租户的浏览器连接。EventSource 只能 GET + cookie——鉴权沿用 session
 * cookie + user_tenants 关系行校验，与数据路由同规矩；租户只由 session
 * claim 决定（x-tenant-* header 一律忽略）。
 *
 * 选 SSE 不选 WebSocket：实时流几乎全单向（服务端 → 客户端）。
 *
 * 断线语义（继承 events/bus 约束）：纯进程内存、无重放——断线期间的
 * 事件丢失，靠客户端降级轮询补齐（useTenantEvents onerror → 轮询兜底）。
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { userTenants } from '../db/schema.js';
import { resolveTenantFromRequest } from '../request-tenant.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';
import type { EventBus, TenantEvent } from '../events/bus.js';

export interface EventsDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
  /** 事件总线（与调度器共享同一实例） */
  bus: EventBus;
}

/** 心跳间隔：注释行保持中间代理不掐空闲连接（25s < 常见 60s 超时） */
const HEARTBEAT_MS = 25_000;

const jsonError = (message: string) => ({ success: false, error: message });

export function createEventsRoutes({ config, bus }: EventsDeps): Hono {
  const app = new Hono();

  app.get('/events', async (c) => {
    const session = await resolveTenantFromRequest(c.req.raw, config.sessionSecret);
    if (!session) {
      return c.json(jsonError('未登录'), 401);
    }
    if (!TENANT_ID_RE.test(session.tenantId)) {
      // 与 data 路由同规矩：畸形 claim（服务端签发，理论不可达）显式拒绝
      return c.json(jsonError('无权访问该租户'), 403);
    }
    const db = await getDb(config.dataDir);
    const membership = await db
      .select()
      .from(userTenants)
      .where(and(eq(userTenants.userId, session.sub), eq(userTenants.tenantId, session.tenantId)))
      .get();
    if (!membership) {
      return c.json(jsonError('无权访问该租户'), 403);
    }
    const { tenantId } = session;
    const encoder = new TextEncoder();
    let closed = false;
    let unsubscribe: () => void = () => {};
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    // controller 在 stream.start 内绑定（订阅前一定已存在）
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;

    const send = (chunk: string): void => {
      if (closed || !streamController) return;
      streamController.enqueue(encoder.encode(chunk));
    };

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
      try {
        streamController?.close();
      } catch {
        // controller 已被消费端 close：忽略
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        // 重连提示（毫秒，EventSource 断线自动重连的等待）
        send('retry: 5000\n\n');

        unsubscribe = bus.subscribe(tenantId, (event: TenantEvent) => {
          send(`data: ${JSON.stringify(event)}\n\n`);
        });
        heartbeat = setInterval(() => {
          // 注释行心跳：不算事件，只保活（< 常见中间代理 60s 空闲超时）
          send(': heartbeat\n\n');
        }, HEARTBEAT_MS);
      },
      cancel() {
        // 消费端 cancel（连接断）不一定触发 request abort——两路都清理
        cleanup();
      },
    });

    // 服务端视角断开（连接关闭）：退订 + 停心跳
    c.req.raw.signal.addEventListener('abort', cleanup);

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    });
  });

  return app;
}
