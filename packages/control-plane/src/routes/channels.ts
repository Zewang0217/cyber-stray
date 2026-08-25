/**
 * channels 路由 — /api/channels*（S10，#77）
 *
 * 每租户推送通道绑定：默认 PWA（Web Push，无需配置）；飞书可选（高级
 * 用户）。飞书 webhook 走 S4 信封加密存储（feishu_webhook），worker-runner
 * 解密注入 AgentSecrets.feishuWebhook——agent 侧 speak() 消费既有配置
 * 字段，推送契约不变。
 *
 * 租户只由 session claim 决定（x-tenant-* header 一律忽略）。
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { userTenants } from '../db/schema.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';
import { openTenantSecrets } from '../secrets/tenant-secrets.js';
import { resolveTenantFromRequest } from '../request-tenant.js';

export interface ChannelsDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
}

/** S4 secrets 存储名（worker-runner SECRET_FIELD_BY_NAME 同名约定） */
export const FEISHU_WEBHOOK_SECRET = 'feishu_webhook';

const jsonError = (message: string) => ({ success: false, error: message });

/** 鉴权 + 租户校验：401 / 403 / { tenantId }（与 pets.ts 同规矩） */
async function scopedTenantId(
  req: Request,
  config: ChannelsDeps['config'],
): Promise<{ tenantId: string } | { error: 401 | 403 }> {
  const session = await resolveTenantFromRequest(req, config.sessionSecret);
  if (!session) return { error: 401 };

  const db = await getDb(config.dataDir);
  const relation = await db
    .select()
    .from(userTenants)
    .where(
      and(eq(userTenants.userId, session.sub), eq(userTenants.tenantId, session.tenantId)),
    )
    .get();
  if (!relation) return { error: 403 };
  if (!TENANT_ID_RE.test(session.tenantId)) return { error: 403 };

  return { tenantId: session.tenantId };
}

export function createChannelsRoutes({ config }: ChannelsDeps): Hono {
  const app = new Hono();

  /** GET /api/channels — 通道绑定状态（只报有无，不回显凭证） */
  app.get('/', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const store = await openTenantSecrets(config.dataDir, scoped.tenantId);
    const names = await store.list();
    return c.json({
      success: true,
      data: {
        feishu: names.includes(FEISHU_WEBHOOK_SECRET),
        webPush: 'default' as const,
      },
    });
  });

  /** PUT /api/channels/feishu — 绑定飞书 webhook（S4 加密存储） */
  app.put('/feishu', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }

    let body: { webhook?: unknown };
    try {
      body = (await c.req.json()) as { webhook?: unknown };
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    const webhook = body.webhook;
    if (typeof webhook !== 'string' || !/^https:\/\//.test(webhook)) {
      return c.json(jsonError('webhook 须为 https URL'), 400);
    }

    const store = await openTenantSecrets(config.dataDir, scoped.tenantId);
    await store.set(FEISHU_WEBHOOK_SECRET, webhook);
    return c.json({ success: true, data: { bound: true } });
  });

  /** DELETE /api/channels/feishu — 解绑 */
  app.delete('/feishu', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const store = await openTenantSecrets(config.dataDir, scoped.tenantId);
    const removed = await store.delete(FEISHU_WEBHOOK_SECRET);
    return c.json({ success: true, data: { removed } });
  });

  return app;
}
