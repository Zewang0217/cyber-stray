/**
 * petgen 路由 — /api/petgen*（#94 宠物 IP 自定义生成，Pro/BYOK 专属）
 *
 * 垂直切片用户面：
 * - POST /api/petgen/tasks：提交 spec（纯文本 + 选项 + 风格预设）→ 异步任务
 *   （状态机由 PetGenProcessor tick 推进；返回后轮询 GET 看进度）
 * - GET  /api/petgen/tasks：当前租户任务列表（新→旧）
 * - GET  /api/petgen/tasks/:id：任务详情（含概念图 URL / 质检结果 / 错误）
 * - POST /api/petgen/tasks/:id/confirm：确认概念图 → 开始多状态生成
 * - POST /api/petgen/tasks/:id/restart：不满意 → 改 spec 重出概念图
 *   （概念图确认是用户锚点，ADR-0001 参考图锁角色）
 * - GET  /api/petgen/tasks/:id/concept.png：概念图草稿（确认流展示）
 * - GET  /api/petgen/quota：本月配额（limit/used/remaining）
 * - GET  /api/petgen/assets/:file：成品素材（manifest.json + 状态 PNG，租户私有）
 *
 * 约束：
 * - 鉴权/租户与 data/pets 同规矩（session claim + user_tenants + TENANT_ID_RE；
 *   x-tenant-* 一律忽略）
 * - 免费用户无入口：plan 非 pro/byok → 403
 * - 配额超限（剩余 0）→ 429；失败任务不占配额（只统计 done）
 */

import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
import { and, desc, eq } from 'drizzle-orm';
import {
  DEFAULT_PET_PRESET,
  isPetPresetId,
  type PetPresetId,
} from '@cyber-stray/shared/pet';
import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { petGenTasks, tenants, userTenants, type PetGenTask } from '../db/schema.js';
import { tenantDataDir } from '../tenant.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';
import { resolveTenantFromRequest } from '../request-tenant.js';
import { petGenQuota, nextMonthStart } from '../petgen/quota.js';
import type { PetSpec, PetGenTaskStatus } from '../petgen/types.js';

export interface PetGenDeps {
  config: Pick<
    ControlPlaneConfig,
    'dataDir' | 'sessionSecret' | 'petGenMonthlyQuota'
  >;
}

const jsonError = (message: string) => ({ success: false, error: message });

/** 鉴权 + 租户校验：401 / 403 / { tenantId }（与 pets.ts 同规矩） */
async function scopedTenantId(
  req: Request,
  config: PetGenDeps['config'],
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

/** 选项字段（均可选，≤100 字符） */
function validOption(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= 100;
}

/** 解析提交/重启的 spec 请求体 */
function parseSpecBody(body: unknown):
  | { spec: PetSpec }
  | { invalid: string } {
  if (typeof body !== 'object' || body === null) {
    return { invalid: '请求体须为 JSON 对象' };
  }
  const { specText, options, stylePreset } = body as {
    specText?: unknown;
    options?: unknown;
    stylePreset?: unknown;
  };
  if (typeof specText !== 'string' || specText.trim().length === 0 || specText.length > 500) {
    return { invalid: 'specText 必填（1-500 字符）' };
  }
  if (stylePreset !== undefined && stylePreset !== null && !isPetPresetId(stylePreset)) {
    return {
      invalid: 'stylePreset 须为 chibi-kawaii|chinese-ink|pixel|3d-render|flat-sticker',
    };
  }
  let parsedOptions: PetSpec['options'];
  if (options !== undefined && options !== null) {
    if (typeof options !== 'object' || options === null) {
      return { invalid: 'options 须为对象' };
    }
    const { palette, size, note } = options as {
      palette?: unknown;
      size?: unknown;
      note?: unknown;
    };
    for (const [key, value] of Object.entries({ palette, size, note })) {
      if (value !== undefined && value !== null && !validOption(value)) {
        return { invalid: `options.${key} 须为 ≤100 字符的非空字符串` };
      }
    }
    parsedOptions = {
      ...(palette !== undefined && palette !== null ? { palette: palette as string } : {}),
      ...(size !== undefined && size !== null ? { size: size as string } : {}),
      ...(note !== undefined && note !== null ? { note: note as string } : {}),
    };
  }
  return {
    spec: {
      specText: specText.trim(),
      options: parsedOptions,
      stylePreset: (stylePreset ?? undefined) as PetPresetId | undefined,
    },
  };
}

/** 租户套餐是否可用 IP 定制（Pro/BYOK 专属；免费无入口） */
async function planAllowed(db: Awaited<ReturnType<typeof getDb>>, tenantId: string): Promise<boolean> {
  const tenant = await db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
  return tenant?.plan === 'pro' || tenant?.plan === 'byok';
}

/** 任务 → API 视图（去掉内部列，附概念图/素材 URL） */
function toTaskView(task: PetGenTask) {
  return {
    id: task.id,
    status: task.status,
    specText: task.specText,
    options: task.options ? (JSON.parse(task.options) as PetSpec['options']) : undefined,
    stylePreset: (task.stylePreset ?? DEFAULT_PET_PRESET) as PetPresetId,
    conceptUrl: task.conceptPath ? `/api/petgen/tasks/${task.id}/concept.png` : null,
    error: task.error,
    qcResult: task.qcResult ? (JSON.parse(task.qcResult) as unknown) : null,
    conceptAttempts: task.conceptAttempts,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    assetBase: task.status === 'done' ? '/api/petgen/assets' : null,
  };
}

/** 素材文件名白名单（防路径穿越；assets 目录只放 manifest + 状态 PNG + concept） */
const ASSET_FILE_RE = /^[a-z0-9][a-z0-9.-]*\.(png|json)$/;

export function createPetGenRoutes({ config }: PetGenDeps): Hono {
  const app = new Hono();

  /** POST /api/petgen/tasks — 提交 spec（Pro/BYOK 专属 + 配额拦截） */
  app.post('/tasks', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const db = await getDb(config.dataDir);
    if (!(await planAllowed(db, scoped.tenantId))) {
      return c.json(jsonError('宠物 IP 定制是 Pro/BYOK 专属功能'), 403);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    const parsed = parseSpecBody(body);
    if ('invalid' in parsed) {
      return c.json(jsonError(parsed.invalid), 400);
    }
    const quota = await petGenQuota(db, scoped.tenantId, config.petGenMonthlyQuota);
    if (quota.remaining <= 0) {
      return c.json(
        {
          success: false,
          error: `本月配额已用完（${quota.limit} 套/月），下月 ${new Date(nextMonthStart(Date.now())).toISOString().slice(0, 7)} 重置`,
          data: { ...quota, resetAt: new Date(nextMonthStart(Date.now())).toISOString().slice(0, 7) },
        },
        429,
      );
    }
    const id = randomUUID();
    const task: PetGenTask = {
      id,
      tenantId: scoped.tenantId,
      status: 'spec_submitted',
      specText: parsed.spec.specText,
      options: parsed.spec.options ? JSON.stringify(parsed.spec.options) : null,
      stylePreset: parsed.spec.stylePreset ?? null,
      conceptPath: null,
      strategy: 'quad',
      batchRetries: 0,
      qcRetries: 0,
      qcResult: null,
      pendingStates: null,
      conceptAttempts: 0,
      error: null,
      completedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.insert(petGenTasks).values(task).run();
    return c.json({ success: true, data: toTaskView(task) }, 201);
  });

  /** GET /api/petgen/tasks — 当前租户任务列表（新→旧） */
  app.get('/tasks', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const db = await getDb(config.dataDir);
    const rows = await db
      .select()
      .from(petGenTasks)
      .where(eq(petGenTasks.tenantId, scoped.tenantId))
      .orderBy(desc(petGenTasks.createdAt))
      .all();
    return c.json({ success: true, data: rows.map(toTaskView) });
  });

  /** GET /api/petgen/tasks/:id — 任务详情（租户隔离：他人任务 404） */
  app.get('/tasks/:id', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const db = await getDb(config.dataDir);
    const task = await db
      .select()
      .from(petGenTasks)
      .where(and(eq(petGenTasks.id, c.req.param('id')), eq(petGenTasks.tenantId, scoped.tenantId)))
      .get();
    if (!task) return c.json(jsonError('任务不存在'), 404);
    return c.json({ success: true, data: toTaskView(task) });
  });

  /** POST /api/petgen/tasks/:id/confirm — 确认概念图 → 多状态生成 */
  app.post('/tasks/:id/confirm', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const db = await getDb(config.dataDir);
    const task = await db
      .select()
      .from(petGenTasks)
      .where(and(eq(petGenTasks.id, c.req.param('id')), eq(petGenTasks.tenantId, scoped.tenantId)))
      .get();
    if (!task) return c.json(jsonError('任务不存在'), 404);
    if (task.status !== 'awaiting_confirmation') {
      return c.json(jsonError(`当前状态 ${task.status} 不可确认（需等待概念图确认）`), 409);
    }
    await db
      .update(petGenTasks)
      .set({ status: 'generating_states', updatedAt: Date.now() })
      .where(eq(petGenTasks.id, task.id))
      .run();
    return c.json({ success: true, data: toTaskView({ ...task, status: 'generating_states' }) });
  });

  /** POST /api/petgen/tasks/:id/restart — 不满意：改 spec 重出概念图 */
  app.post('/tasks/:id/restart', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    const parsed = parseSpecBody(body);
    if ('invalid' in parsed) {
      return c.json(jsonError(parsed.invalid), 400);
    }
    const db = await getDb(config.dataDir);
    const task = await db
      .select()
      .from(petGenTasks)
      .where(and(eq(petGenTasks.id, c.req.param('id')), eq(petGenTasks.tenantId, scoped.tenantId)))
      .get();
    if (!task) return c.json(jsonError('任务不存在'), 404);
    if (task.status !== 'awaiting_confirmation' && task.status !== 'failed') {
      return c.json(jsonError(`当前状态 ${task.status} 不可重来（仅等待确认/失败后可改 spec）`), 409);
    }
    // 重启也是一次"生成尝试"：配额超限同样拦截（防绕过）
    const quota = await petGenQuota(db, scoped.tenantId, config.petGenMonthlyQuota);
    if (quota.remaining <= 0) {
      return c.json({ success: false, error: '本月配额已用完', data: quota }, 429);
    }
    const now = Date.now();
    await db
      .update(petGenTasks)
      .set({
        specText: parsed.spec.specText,
        options: parsed.spec.options ? JSON.stringify(parsed.spec.options) : null,
        stylePreset: parsed.spec.stylePreset ?? null,
        status: 'spec_submitted' as PetGenTaskStatus,
        conceptPath: null,
        strategy: 'quad',
        batchRetries: 0,
        qcRetries: 0,
        qcResult: null,
        pendingStates: null,
        error: null,
        completedAt: null,
        updatedAt: now,
      })
      .where(eq(petGenTasks.id, task.id))
      .run();
    const updated = await db
      .select()
      .from(petGenTasks)
      .where(eq(petGenTasks.id, task.id))
      .get();
    return c.json({ success: true, data: toTaskView(updated ?? task) });
  });

  /** GET /api/petgen/tasks/:id/concept.png — 概念图草稿（确认流展示） */
  app.get('/tasks/:id/concept.png', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const db = await getDb(config.dataDir);
    const task = await db
      .select()
      .from(petGenTasks)
      .where(and(eq(petGenTasks.id, c.req.param('id')), eq(petGenTasks.tenantId, scoped.tenantId)))
      .get();
    if (!task || !task.conceptPath) return c.json(jsonError('概念图不存在'), 404);
    try {
      const abs = join(tenantDataDir(config.dataDir, scoped.tenantId), task.conceptPath);
      const bytes = await readFile(abs);
      return c.body(bytes, 200, { 'content-type': 'image/png' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return c.json(jsonError('概念图不存在'), 404);
      }
      throw error;
    }
  });

  /** GET /api/petgen/quota — 本月配额（剩余量展示） */
  app.get('/quota', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const db = await getDb(config.dataDir);
    if (!(await planAllowed(db, scoped.tenantId))) {
      return c.json({ success: true, data: { limit: 0, used: 0, remaining: 0, available: false } });
    }
    const quota = await petGenQuota(db, scoped.tenantId, config.petGenMonthlyQuota);
    return c.json({
      success: true,
      data: {
        ...quota,
        available: true,
        resetAt: new Date(nextMonthStart(Date.now())).toISOString().slice(0, 7),
      },
    });
  });

  /** GET /api/petgen/assets/:file — 成品素材（manifest + 状态 PNG，租户私有） */
  app.get('/assets/:file', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const file = c.req.param('file');
    if (!ASSET_FILE_RE.test(file)) {
      return c.json(jsonError('非法文件名'), 400);
    }
    const abs = join(tenantDataDir(config.dataDir, scoped.tenantId), 'pet-assets', file);
    try {
      const bytes = await readFile(abs);
      const contentType = extname(file) === '.json' ? 'application/json' : 'image/png';
      return c.body(bytes, 200, { 'content-type': contentType });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return c.json(jsonError('素材不存在'), 404);
      }
      throw error;
    }
  });

  return app;
}
