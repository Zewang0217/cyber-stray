/**
 * feedback 路由 — /api/feedback + /api/boost（S9，#76）
 *
 * 点赞/踩（不受限，低价值高频信号）+ 顶话题（按 plan 节流）。
 * 反馈目标 = 该租户宠物（租户只由 session claim 决定，x-tenant-* 忽略）。
 *
 * 处理方式：spawn agent feedback-cli 短命进程（与 worker-runner 同模式），
 * 复用 agent 反馈管道（feedback.json + 用户画像 + 兴趣图谱 + 心情）——
 * 控制面不复制图谱逻辑。反馈处理不需要 secrets/LLM。
 *
 * 节流（顶话题，显式"我要更多"高价值信号）：
 * - free：30 天 1 次；pro/byok：1 天 1 次（S11 计费接入后按 plan 字段生效）
 * - 拒绝时 429，不 spawn worker
 */

import { Hono } from 'hono';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { planLimits } from '../plan/limits.js';
import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { pets, userTenants } from '../db/schema.js';
import { tenantDataDir } from '../tenant.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';
import { resolveTenantFromRequest } from '../request-tenant.js';

/** agent feedback CLI 绝对路径（仓库内锚定，与 worker-runner 的 AGENT_CLI 同模式） */
const FEEDBACK_CLI = fileURLToPath(
  new URL('../../../agent/src/worker/feedback-cli.ts', import.meta.url),
);

// 顶话题节流间隔：统一策略源（S11 plan/limits.ts）

/** topic 最大长度（字符） */
const TOPIC_MAX_CHARS = 50;

/** 注入式 spawn（测试用 fake）；捕获 stdout（feedback-cli 输出一行 JSON 结果） */
export type FeedbackSpawn = (
  cmd: string,
  args: string[],
) => Promise<{ exitCode: number; stdout: string }>;

const realSpawn: FeedbackSpawn = (cmd, args) => {
  const { promise, resolve, reject } = Promise.withResolvers<{
    exitCode: number;
    stdout: string;
  }>();
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const out: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => out.push(chunk.toString('utf8')));
  const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
  child.on('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.on('exit', (code) => {
    clearTimeout(timer);
    resolve({ exitCode: code ?? -1, stdout: out.join('') });
  });
  return promise;
};

export interface FeedbackDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
  /** 注入式 spawn（测试）；缺省真实 spawn */
  spawnFn?: FeedbackSpawn;
}

const jsonError = (message: string) => ({ success: false, error: message });

/** 鉴权 + 租户校验：401 / 403 / { tenantId }（与 pets.ts 同规矩） */
async function scopedTenantId(
  req: Request,
  config: FeedbackDeps['config'],
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

export function createFeedbackRoutes({ config, spawnFn = realSpawn }: FeedbackDeps): Hono {
  const app = new Hono();
  const command = process.env.CP_WORKER_CMD ?? 'bun';

  /** spawn feedback-cli 并透传其 stdout 结果（一行 JSON） */
  async function runFeedbackWorker(
    tenantId: string,
    args: string[],
  ): Promise<{ data?: unknown; error?: string }> {
    const dataDir = tenantDataDir(config.dataDir, tenantId);
    try {
      const { exitCode, stdout } = await spawnFn(command, [
        FEEDBACK_CLI,
        '--data-dir',
        dataDir,
        ...args,
      ]);
      if (exitCode !== 0) {
        console.error(`[feedback] worker 退出码 ${exitCode}（${tenantId}）`);
        return { error: '反馈处理失败' };
      }
      const parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '') as {
        ok: boolean;
        result?: unknown;
        error?: string;
      };
      if (!parsed.ok) return { error: parsed.error ?? '反馈处理失败' };
      return { data: parsed.result };
    } catch (error) {
      console.error(`[feedback] 拉起失败（${tenantId}）：`, error);
      return { error: '反馈处理失败' };
    }
  }

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

    const db = await getDb(config.dataDir);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, scoped.tenantId)).get();
    if (!pet) {
      return c.json(jsonError('尚未领养宠物'), 409);
    }

    const worker = await runFeedbackWorker(scoped.tenantId, [
      '--action',
      'feedback',
      '--type',
      type,
      '--message-id',
      messageId,
      '--user-id',
      scoped.tenantId,
    ]);
    if (worker.error) {
      return c.json(jsonError(worker.error), 502);
    }
    return c.json({ success: true, data: worker.data ?? {} });
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

    const db = await getDb(config.dataDir);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, scoped.tenantId)).get();
    if (!pet) {
      return c.json(jsonError('尚未领养宠物'), 409);
    }

    // 节流：按 plan 间隔原子占位（check-then-write 横跨 spawn 会开并发窗口，
    // 双击/双标签页可绕过额度）。单条 UPDATE 原子完成"检查间隔 + 记账"，
    // rowsAffected=0 即已被占 → 429 不 spawn；worker 失败时回滚额度。
    const interval = planLimits(pet.plan).boostIntervalMs;
    const now = Date.now();
    const cutoff = now - interval;
    const claimed = await db
      .update(pets)
      .set({ lastBoostAt: now })
      .where(
        and(
          eq(pets.tenantId, scoped.tenantId),
          or(isNull(pets.lastBoostAt), lt(pets.lastBoostAt, cutoff)),
        ),
      )
      .run();
    if (claimed.rowsAffected === 0) {
      const days = Math.ceil(interval / (24 * 60 * 60 * 1000));
      return c.json(jsonError(`当前套餐每 ${days} 天可顶一次话题`), 429);
    }

    const worker = await runFeedbackWorker(scoped.tenantId, [
      '--action',
      'boost',
      '--topic',
      topic.trim(),
      '--user-id',
      scoped.tenantId,
    ]);
    if (worker.error) {
      // worker 失败不消耗额度：回滚到占位前的值
      await db
        .update(pets)
        .set({ lastBoostAt: pet.lastBoostAt })
        .where(eq(pets.tenantId, scoped.tenantId))
        .run();
      return c.json(jsonError(worker.error), 502);
    }

    return c.json({ success: true, data: worker.data ?? {} });
  });

  return app;
}
