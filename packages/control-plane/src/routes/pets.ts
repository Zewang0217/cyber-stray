/**
 * pets 路由 — /api/pets*（接口层）
 *
 * 领养旅程的服务端：
 * - GET /api/pets：当前租户宠物列表（空数组 = 未领养，前端据此走领养流程）
 * - POST /api/pets/adopt：起名 + 初始兴趣（默认种子见 shared DEFAULT_INTEREST_SEEDS，可改）
 * - PUT/DELETE /api/pets/sleep-schedule：作息（本地小时；跨午夜合法）
 * - PUT /api/pets/diary-style、/api/pets/diary-push：日记风格与每日日记推送开关
 * - POST /api/pets/adoption-candidates：起名/口头禅步的 3 候选
 * - PUT /api/pets/catchphrases：编辑口头禅集合（至少 1 条）
 *
 * 约束：
 * - 鉴权/租户范围与 feedback 等路由同规矩（session claim + user_tenants 关系行 +
 *   TENANT_ID_RE；x-tenant-* 一律忽略）
 * - 幂等冲突：租户已有宠物 → 409 返回现有（当前 1 租户 1 宠物）
 * - 种子不覆盖：兴趣种子文件已存在（租户已游荡）→ 只建宠物行不写种子
 *
 * 本文件只做鉴权、参数校验与 HTTP 映射；用例编排在 services/pets-service，
 * 存储在 infra/pets-repo，种子形状单一真相源在 shared/interest-graph。
 */

import { Hono } from 'hono';
import type { Catchphrase, PersonalityId } from '@cyber-stray/shared';
import {
  DEFAULT_PERSONALITY,
  getPersonality,
  isPersonalityId,
  parseCatchphraseList,
} from '@cyber-stray/shared';
import { isDiaryStyleChoice } from '@cyber-stray/shared/diary';
import { DEFAULT_INTEREST_SEEDS } from '@cyber-stray/shared/interest-graph';
import type { ControlPlaneConfig } from '../config.js';
import { findUserTenantRelation } from '../infra/tenant-access.js';
import { noteTenantActivity } from '../infra/tenant-activity.js';
import { resolveTenantFromRequest } from '../auth/request-tenant.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';
import { createPetsService, type AdoptInput } from '../services/pets-service.js';
import { createPetGenService } from '../services/petgen-service.js';
import { ADOPT_REFERENCE_MIME, ADOPT_REFERENCE_MAX_BYTES } from '@cyber-stray/shared/pet';
import { CandidateRequestSchema } from '../adoption/candidates.js';
import { CandidateRequestError } from '../adoption/candidate-store.js';

export interface PetsDeps {
  config: Pick<
    ControlPlaneConfig,
    | 'dataDir'
    | 'productMode'
    | 'sessionSecret'
    | 'llmBudgetEnabled'
    | 'llmBudgetYuan'
    | 'petGenMonthlyQuota'
    | 'adoptLlmModel'
  >;
}

const jsonError = (message: string) => ({ success: false, error: message });

/** 领养参考图 mime 白名单（shared 同源） */
const ADOPT_REFERENCE_MIME_SET = new Set(ADOPT_REFERENCE_MIME);

/** 鉴权 + 租户校验：401 / 403 / { tenantId }（与 feedback.ts 同规矩） */
async function scopedTenantId(
  req: Request,
  config: PetsDeps['config'],
): Promise<{ tenantId: string } | { error: 401 | 403 }> {
  const session = await resolveTenantFromRequest(req, config.sessionSecret);
  if (!session) return { error: 401 };

  const relation = await findUserTenantRelation(config.dataDir, session.sub, session.tenantId);
  if (!relation) return { error: 403 };
  if (!TENANT_ID_RE.test(session.tenantId)) return { error: 403 };

  // X1「回访」埋点（与 requireTenant 同款；领养旅程主端点走本路由组）
  noteTenantActivity(config.dataDir, session.tenantId);
  return { tenantId: session.tenantId };
}

/** 有效小时（0-23 整数；作息与 pushWindow 同为本地小时） */
function validHour(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23;
}

/** adopt 请求体 */
interface AdoptBody {
  name?: unknown;
  interests?: unknown;
  /** 性格（可选，默认 DEFAULT_PERSONALITY） */
  personality?: unknown;
  /** 口头禅（可选，默认 = 所选性格的默认组） */
  catchphrases?: unknown;
}

/** 校验 adopt 入参；通过返回 AdoptInput，失败返回错误消息 */
function parseAdoptBody(body: AdoptBody): AdoptInput | { invalid: string } {
  const name = body.name;
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 32) {
    return { invalid: 'name 必填（1-32 字符）' };
  }
  // 未传 interests → 用领养默认种子（单一真相源 shared，与 agent seedDefaults 同源）
  let interests = [...DEFAULT_INTEREST_SEEDS];
  if (body.interests !== undefined) {
    if (
      !Array.isArray(body.interests) ||
      body.interests.length === 0 ||
      body.interests.length > 12 ||
      !body.interests.every((i) => typeof i === 'string' && i.trim().length > 0 && i.length <= 24)
    ) {
      return { invalid: 'interests 须为 1-12 个非空字符串（每项 ≤24 字符）' };
    }
    interests = body.interests;
  }
  let personality: PersonalityId = DEFAULT_PERSONALITY;
  if (body.personality !== undefined) {
    if (!isPersonalityId(body.personality)) {
      return { invalid: 'personality 须为 curious|playful|lazy|steady' };
    }
    personality = body.personality;
  }
  let catchphrases: Catchphrase[];
  if (body.catchphrases === undefined) {
    catchphrases = getPersonality(personality).catchphrases;
  } else {
    const parsed = parseCatchphraseList(body.catchphrases);
    if (typeof parsed === 'string') return { invalid: parsed };
    catchphrases = parsed;
  }
  return { name: name.trim(), interests, personality, catchphrases };
}

export function createPetsRoutes({ config }: PetsDeps): Hono {
  const service = createPetsService({ config });
  const petGenService = createPetGenService({ config });
  const app = new Hono();

  /** GET /api/pets — 当前租户宠物列表（含 budgetPaused 初始态） */
  app.get('/pets', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const data = await service.listPets(scoped.tenantId);
    return c.json({ success: true, data });
  });

  /** POST /api/pets/adopt — 领养：建宠物行 + 兴趣种子 */
  app.post('/pets/adopt', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }

    let body: AdoptBody;
    try {
      body = (await c.req.json()) as AdoptBody;
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    const parsed = parseAdoptBody(body);
    if ('invalid' in parsed) {
      return c.json(jsonError(parsed.invalid), 400);
    }

    const outcome = await service.adopt(scoped.tenantId, parsed);
    if (outcome.ok) {
      // 领养精灵图（领养不阻塞）：内部 try/catch 吞失败只记日志；await 只覆盖
      // 建行（毫秒级 DB 写），真正的生图在 petgen 异步队列推进，素材就绪后经
      // pet_assets_ready 事件热替换形象
      await petGenService.adoptSheetSideEffect(scoped.tenantId, parsed);
    }
    return outcome.ok
      ? c.json({ success: true, data: outcome.data }, 201)
      : c.json(
          {
            success: false,
            error: outcome.error,
            ...(outcome.data !== undefined ? { data: outcome.data } : {}),
          },
          outcome.status,
        );
  });

  /** POST /api/pets/adopt/reference — 上传形象参考图（图生图角色锚点，可选） */
  app.post('/pets/adopt/reference', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    let file: File;
    try {
      const form = await c.req.formData();
      const entry = form.get('file');
      if (!(entry instanceof File)) {
        return c.json(jsonError('缺少 file 字段（multipart/form-data）'), 400);
      }
      file = entry;
    } catch {
      return c.json(jsonError('请求体须为 multipart/form-data'), 400);
    }
    if (!ADOPT_REFERENCE_MIME_SET.has(file.type)) {
      return c.json(jsonError('仅支持 PNG/JPEG/WebP 图片'), 400);
    }
    if (file.size > ADOPT_REFERENCE_MAX_BYTES) {
      return c.json(jsonError('图片须 ≤ 8MB'), 400);
    }
    try {
      await petGenService.saveAdoptReference(
        scoped.tenantId,
        Buffer.from(await file.arrayBuffer()),
      );
    } catch (error) {
      // 压平失败 = 图片不可解析/脚本异常——显式报错让用户换图，不静默吞
      return c.json(
        jsonError(`参考图处理失败：${error instanceof Error ? error.message : String(error)}`),
        400,
      );
    }
    return c.json({ success: true, data: { uploaded: true } });
  });

  /** PUT /api/pets/sleep-schedule — 设置作息（本地小时；跨午夜合法） */
  app.put('/pets/sleep-schedule', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }

    let body: { startHour?: unknown; endHour?: unknown };
    try {
      body = (await c.req.json()) as { startHour?: unknown; endHour?: unknown };
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    if (!validHour(body.startHour) || !validHour(body.endHour)) {
      return c.json(jsonError('startHour/endHour 须为 0-23 整数'), 400);
    }
    if (body.startHour === body.endHour) {
      return c.json(jsonError('startHour 不能等于 endHour（空窗口）'), 400);
    }

    const outcome = await service.setSleepSchedule(scoped.tenantId, body.startHour, body.endHour);
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json(jsonError(outcome.error), outcome.status);
  });

  /** DELETE /api/pets/sleep-schedule — 清除作息（回永不睡眠，与既有行为一致） */
  app.delete('/pets/sleep-schedule', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const outcome = await service.clearSleepSchedule(scoped.tenantId);
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json(jsonError(outcome.error), outcome.status);
  });

  /** PUT /api/pets/diary-style — 设置日记风格（'personality' = 跟随性格） */
  app.put('/pets/diary-style', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }

    let body: { diaryStyle?: unknown };
    try {
      body = (await c.req.json()) as { diaryStyle?: unknown };
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    const diaryStyle = body.diaryStyle;
    if (!isDiaryStyleChoice(diaryStyle)) {
      return c.json(jsonError('diaryStyle 须为 personality|casual|careful|literary'), 400);
    }

    const outcome = await service.setDiaryStyle(scoped.tenantId, diaryStyle);
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json(jsonError(outcome.error), outcome.status);
  });

  /** PUT /api/pets/diary-push — 设置是否推送每日日记（Web Push） */
  app.put('/pets/diary-push', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }

    let body: { enabled?: unknown };
    try {
      body = (await c.req.json()) as { enabled?: unknown };
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    if (typeof body.enabled !== 'boolean') {
      return c.json(jsonError('enabled 须为 boolean'), 400);
    }

    const outcome = await service.setDiaryPush(scoped.tenantId, body.enabled);
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json(jsonError(outcome.error), outcome.status);
  });

  /** POST /api/pets/adoption-candidates — 起名/口头禅步的 3 候选 */
  app.post('/pets/adoption-candidates', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }

    let body: unknown;
    try { body = await c.req.json(); }
    catch { return c.json(jsonError('请求体须为 JSON'), 400); }
    const parsed = CandidateRequestSchema.safeParse(body);
    if (!parsed.success) return c.json(jsonError('候选参数无效：batch 须为 0-3 整数，口头禅需要名字与性格'), 400);
    try {
      const result = await service.adoptionCandidates(scoped.tenantId, parsed.data);
      return c.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof CandidateRequestError) return c.json(jsonError(error.message), error.status);
      throw error;
    }
  });

  /** PUT /api/pets/catchphrases — 编辑口头禅集合（至少 1 条） */
  app.put('/pets/catchphrases', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }

    let body: { catchphrases?: unknown };
    try {
      body = (await c.req.json()) as { catchphrases?: unknown };
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    const parsed = parseCatchphraseList(body.catchphrases);
    if (typeof parsed === 'string') {
      return c.json(jsonError(parsed), 400);
    }

    const outcome = await service.updateCatchphrases(scoped.tenantId, parsed);
    return outcome.ok
      ? c.json({ success: true, data: outcome.data })
      : c.json(jsonError(outcome.error), outcome.status);
  });

  return app;
}
