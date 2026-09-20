/**
 * channels 路由 — /api/channels*（接口层）
 *
 * 每租户推送通道绑定：默认 PWA（Web Push，无需配置）；飞书可选（高级
 * 用户）。webhook 走信封加密存储，worker-runner 解密注入 AgentSecrets
 * ——agent 侧 speak() 消费既有配置字段，推送契约不变。
 *
 * 租户隔离走 requireTenant 中间件（x-tenant-* header 一律忽略）；
 * secrets 读写编排在 services/channels-service。
 */

import { Hono } from 'hono';
import type { ControlPlaneConfig } from '../config.js';
import { requireTenant, type TenantEnv } from '../middleware/require-tenant.js';
import { createChannelsService } from '../services/channels-service.js';

export interface ChannelsDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
}

export function createChannelsRoutes({ config }: ChannelsDeps): Hono<TenantEnv> {
  const service = createChannelsService({ config });
  const app = new Hono<TenantEnv>();

  app.use('*', requireTenant(config));

  /** GET /api/channels — 通道绑定状态（只报有无，不回显凭证） */
  app.get('/', async (c) => {
    return c.json({ success: true, data: await service.getStatus(c.get('tenantId')) });
  });

  /** PUT /api/channels/feishu — 绑定飞书 webhook（信封加密存储） */
  app.put('/feishu', async (c) => {
    let body: { webhook?: unknown };
    try {
      body = (await c.req.json()) as { webhook?: unknown };
    } catch {
      return c.json({ success: false, error: '请求体须为 JSON' }, 400);
    }
    const webhook = body.webhook;
    if (typeof webhook !== 'string' || !/^https:\/\//.test(webhook)) {
      return c.json({ success: false, error: 'webhook 须为 https URL' }, 400);
    }

    return c.json({ success: true, data: await service.bindFeishu(c.get('tenantId'), webhook) });
  });

  /** DELETE /api/channels/feishu — 解绑 */
  app.delete('/feishu', async (c) => {
    return c.json({ success: true, data: await service.unbindFeishu(c.get('tenantId')) });
  });

  return app;
}
