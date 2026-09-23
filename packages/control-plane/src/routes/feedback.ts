/**
 * feedback 路由 — /api/feedback + /api/boost（接口层）
 *
 * 点赞/踩（不受限，低价值高频信号）+ 顶话题（按 plan 节流）。
 * 本文件只做鉴权、参数校验与 HTTP 映射：
 * 用例编排在 services/feedback-service，子进程协议与存储在 infra/，
 * 纯规则在 domain/。反馈处理不需要 secrets/LLM。
 *
 * 顶话题节流：free 30 天 1 次；pro/byok 1 天 1 次（策略源 plan/limits.ts）；
 * 拒绝时 429，不 spawn worker。反馈目标 = 该租户宠物（租户只由 session
 * claim 决定，x-tenant-* 忽略）。
 */

import { Hono } from 'hono';
import type { ControlPlaneConfig } from '../config.js';
import type { CliSpawn } from '../infra/agent-cli-client.js';
import { findUserTenantRelation } from '../infra/tenant-access.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';
import { createFeedbackService } from '../services/feedback-service.js';
import { resolveTenantFromRequest } from '../auth/request-tenant.js';

/** topic 最大长度（字符） */
const TOPIC_MAX_CHARS = 50;

export interface FeedbackDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
  /** 注入式 spawn（测试）；缺省真实 spawn */
  spawnFn?: CliSpawn;
}

const jsonError = (message: string) => ({ success: false, error: message });

/** 鉴权 + 租户校验：401 / 403 / { tenantId }（与 pets.ts 同规矩） */
async function scopedTenantId(
  req: Request,
  config: FeedbackDeps['config'],
): Promise<{ tenantId: string } | { error: 401 | 403 }> {
  const session = await resolveTenantFromRequest(req, config.sessionSecret);
  if (!session) return { error: 401 };

  const relation = await findUserTenantRelation(config.dataDir, session.sub, session.tenantId);
  if (!relation) return { error: 403 };
  if (!TENANT_ID_RE.test(session.tenantId)) return { error: 403 };

  return { tenantId: session.tenantId };
}

export function createFeedbackRoutes({ config, spawnFn }: FeedbackDeps): Hono {
  const service = createFeedbackService({ config, spawnFn });
  const app = new Hono();

  /** POST /api/feedback — 点赞/踩（不受限） */
  app.post('/feedback', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }

    let body: { type?: unknown; messageId?: unknown };
    try {
      body = (await c.req.json()) as { type?: unknown; messageId?: unknown };
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    const type = body.type;
    const messageId = body.messageId;
    if ((type !== 'like' && type !== 'dislike') || typeof messageId !== 'string' || !messageId) {
      return c.json(jsonError('type 须为 like|dislike 且 messageId 必填'), 400);
    }

    const outcome = await service.submitFeedback(scoped.tenantId, { type, messageId });
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json(jsonError(outcome.error), outcome.status);
  });

  /** POST /api/boost — 顶话题（按 plan 节流） */
  app.post('/boost', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }

    let body: { topic?: unknown };
    try {
      body = (await c.req.json()) as { topic?: unknown };
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    const topic = body.topic;
    if (typeof topic !== 'string' || !topic.trim() || [...topic.trim()].length > TOPIC_MAX_CHARS) {
      return c.json(jsonError(`topic 必填且不超过 ${TOPIC_MAX_CHARS} 字`), 400);
    }

    const outcome = await service.boostTopic(scoped.tenantId, topic.trim());
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json(jsonError(outcome.error), outcome.status);
  });

  return app;
}
