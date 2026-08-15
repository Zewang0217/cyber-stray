/**
 * 控制面 Hono 应用组装（依赖注入，可测）
 */

import { Hono } from 'hono';
import type { ControlPlaneConfig } from './config.js';
import type { OidcProvider } from './oidc.js';
import type { EventBus } from './events/bus.js';
import { createAuthRoutes } from './routes/auth.js';
import { StateStore } from './state-store.js';
import { createDataRoutes } from './routes/data.js';
import { createPetsRoutes } from './routes/pets.js';
import { createEventsRoutes } from './routes/events.js';
import { createFeedbackRoutes } from './routes/feedback.js';
export interface AppDeps {
  config: ControlPlaneConfig;
  oidc: OidcProvider;
  /** 事件总线（与调度器共享；SSE 路由消费调度器发布的事件） */
  bus: EventBus;
}

export function createApp({ config, oidc, bus }: AppDeps): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.route('/api/auth', createAuthRoutes({ config, oidc, states: new StateStore() }));

  // S6：Web 只读数据面（鉴权 + 按会话租户路由）
  app.route('/api', createDataRoutes({ config }));

  // S7：领养旅程（写路径：建宠物行 + 兴趣种子；仍以 session claim 定租户）
  app.route('/api', createPetsRoutes({ config }));

  // S8：应用内实时（SSE，调度器事件 → 租户浏览器连接）
  app.route('/api', createEventsRoutes({ config, bus }));

  // S9：反馈回路（点赞/踩 + 顶话题节流；spawn agent feedback-cli 复用反馈管道）
  app.route('/api', createFeedbackRoutes({ config }));

  return app;
}
