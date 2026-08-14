/**
 * 控制面 Hono 应用组装（依赖注入，可测）
 */

import { Hono } from 'hono';
import type { ControlPlaneConfig } from './config.js';
import type { OidcProvider } from './oidc.js';
import { StateStore } from './state-store.js';
import { createAuthRoutes } from './routes/auth.js';

export interface AppDeps {
  config: ControlPlaneConfig;
  oidc: OidcProvider;
}

export function createApp({ config, oidc }: AppDeps): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.route('/api/auth', createAuthRoutes({ config, oidc, states: new StateStore() }));

  return app;
}
