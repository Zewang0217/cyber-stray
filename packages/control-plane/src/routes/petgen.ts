/**
 * petgen 路由 — /api/petgen*（接口层）
 *
 * 宠物 IP 自定义生成（Pro/BYOK 专属）的用户面：
 * - POST /api/petgen/tasks：提交 spec → 异步任务（PetGenProcessor tick 推进）
 * - GET  /api/petgen/tasks[/turbo/:id]：列表 / 详情 / 概念图 / 确认 / 重启
 * - GET  /api/petgen/quota：本月配额；GET /api/petgen/assets/:file：成品素材
 *
 * 约束：租户隔离走 requireTenant 中间件；免费用户无入口（403）；配额超限
 * 429；失败任务不占配额（只统计 done）。用例在 services/petgen-service，
 * 存储在 infra/petgen-repo；spec/文件名校验留本层（边界校验）。
 */

import { Hono } from 'hono';
import { isPetPresetId, type PetPresetId } from '@cyber-stray/shared/pet';
import type { ControlPlaneConfig } from '../config.js';
import { requireTenant, type TenantEnv } from '../middleware/require-tenant.js';
import type { PetSpec } from '../petgen/types.js';
import { createPetGenService } from '../services/petgen-service.js';

export interface PetGenDeps {
  config: Pick<
    ControlPlaneConfig,
    'dataDir' | 'sessionSecret' | 'petGenMonthlyQuota'
  >;
}

const jsonError = (message: string) => ({ success: false, error: message });

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

/** 素材文件名白名单（防路径穿越；assets 目录只放 manifest + 状态 PNG + concept） */
const ASSET_FILE_RE = /^[a-z0-9][a-z0-9.-]*\.(png|json)$/;

export function createPetGenRoutes({ config }: PetGenDeps): Hono<TenantEnv> {
  const service = createPetGenService({ config });
  const app = new Hono<TenantEnv>();

  app.use('*', requireTenant(config));

  /** POST /api/petgen/tasks — 提交 spec（Pro/BYOK 专属 + 配额拦截） */
  app.post('/tasks', async (c) => {
    // 套餐闸先于请求体校验（旧实现顺序）：免费用户 403，不泄露参数校验细节
    const planGate = await service.ensureProPlan(c.get('tenantId'));
    if (planGate) {
      return c.json(jsonError(planGate.error), planGate.status);
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
    const outcome = await service.submitTask(c.get('tenantId'), parsed.spec);
    return outcome.ok
      ? c.json({ success: true, data: outcome.data }, 201)
      : c.json(
          { success: false, error: outcome.error, ...(outcome.data !== undefined ? { data: outcome.data } : {}) },
          outcome.status,
        );
  });

  /** GET /api/petgen/tasks — 当前租户任务列表（新→旧） */
  app.get('/tasks', async (c) => {
    return c.json({ success: true, data: await service.listTasks(c.get('tenantId')) });
  });

  /** GET /api/petgen/tasks/:id — 任务详情（租户隔离：他人任务 404） */
  app.get('/tasks/:id', async (c) => {
    const task = await service.getTask(c.get('tenantId'), c.req.param('id'));
    return task ? c.json({ success: true, data: task }) : c.json(jsonError('任务不存在'), 404);
  });

  /** POST /api/petgen/tasks/:id/confirm — 确认概念图 → 多状态生成 */
  app.post('/tasks/:id/confirm', async (c) => {
    const outcome = await service.confirmTask(c.get('tenantId'), c.req.param('id'));
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json(jsonError(outcome.error), outcome.status);
  });

  /** POST /api/petgen/tasks/:id/restart — 不满意：改 spec 重出概念图 */
  app.post('/tasks/:id/restart', async (c) => {
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
    const outcome = await service.restartTask(c.get('tenantId'), c.req.param('id'), parsed.spec);
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json(
          { success: false, error: outcome.error, ...(outcome.data !== undefined ? { data: outcome.data } : {}) },
          outcome.status,
        );
  });

  /** GET /api/petgen/tasks/:id/concept.png — 概念图草稿（确认流展示） */
  app.get('/tasks/:id/concept.png', async (c) => {
    const bytes = await service.getConceptPng(c.get('tenantId'), c.req.param('id'));
    return bytes
      ? c.body(new Uint8Array(bytes), 200, { 'content-type': 'image/png' })
      : c.json(jsonError('概念图不存在'), 404);
  });

  /** GET /api/petgen/quota — 本月配额（剩余量展示） */
  app.get('/quota', async (c) => {
    return c.json({ success: true, data: await service.getQuota(c.get('tenantId')) });
  });

  /** GET /api/petgen/assets/:file — 成品素材（manifest + 状态 PNG，租户私有） */
  app.get('/assets/:file', async (c) => {
    const file = c.req.param('file');
    if (!ASSET_FILE_RE.test(file)) {
      return c.json(jsonError('非法文件名'), 400);
    }
    const asset = await service.getAsset(c.get('tenantId'), file);
    return asset
      ? c.body(new Uint8Array(asset.bytes), 200, { 'content-type': asset.contentType })
      : c.json(jsonError('素材不存在'), 404);
  });

  return app;
}
