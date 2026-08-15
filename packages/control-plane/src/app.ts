/**
 * 控制面 Hono 应用组装（依赖注入，可测）
 */

import { Hono } from 'hono';
import type { ControlPlaneConfig } from './config.js';
import type { OidcProvider } from './oidc.js';
import { createAuthRoutes } from './routes/auth.js';
import { StateStore } from './state-store.js';
import { createDataRoutes } from './routes/data.js';
import { createPetsRoutes } from './routes/pets.js';

export interface AppDeps {
  config: ControlPlaneConfig;
  oidc: OidcProvider;
}

export function createApp({ config, oidc }: AppDeps): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.route('/api/auth', createAuthRoutes({ config, oidc, states: new StateStore() }));

  // S6：Web 只读数据面（鉴权 + 按会话租户路由）
  app.route('/api', createDataRoutes({ config }));

  // S7：领养旅程（写路径：建宠物行 + 兴趣种子；仍以 session claim 定租户）
  app.route('/api', createPetsRoutes({ config }));

  return app;
}
