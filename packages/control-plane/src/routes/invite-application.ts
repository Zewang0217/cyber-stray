/**
 * 邀请申请路由 — /api/apply（公开面，无登录态）
 *
 * POST /api/apply          提交申请 → { applicationId, secret }（查询码只此一次）
 * GET  /api/apply/status   凭据对查询 → { status, inviteUrl? }
 *
 * 完全公开（限流在 service 层）：注册门前的用户没有 session，鉴权即
 * 「申请号 + 查询码」凭据对本身。admin 审批端点在 routes/admin.ts。
 */

import { Hono } from 'hono';
import { ApplyRequestSchema, isApplicationId, isApplicationSecret } from '@cyber-stray/shared/invite-application';
import type { ControlPlaneConfig } from '../config.js';
import { createInviteApplicationService } from '../services/invite-application-service.js';

export interface ApplyDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'webOrigin'>;
}

export function createApplyRoutes({ config }: ApplyDeps): Hono {
  const service = createInviteApplicationService({ config });
  const app = new Hono();

  app.post('/', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: '请求体须为 JSON' }, 400);
    }
    const parsed = ApplyRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '理由须为 8 至 500 字，昵称最多 32 字' }, 400);
    }
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown';
    const outcome = await service.submit({ ip, nickname: parsed.data.nickname ?? null, reason: parsed.data.reason });
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json({ success: false, error: outcome.error }, outcome.status);
  });

  app.get('/status', async (c) => {
    const id = c.req.query('id');
    const secret = c.req.query('secret');
    if (!isApplicationId(id) || !isApplicationSecret(secret)) {
      return c.json({ success: false, error: '申请号或查询码格式不对' }, 400);
    }
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown';
    const outcome = await service.query(id, secret, ip);
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json({ success: false, error: outcome.error }, outcome.status);
  });

  return app;
}
