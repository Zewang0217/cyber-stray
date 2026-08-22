/**
 * pets 路由 — /api/pets*（S7 领养，#74）
 *
 * 领养旅程的服务端：
 * - GET /api/pets：当前租户宠物列表（空数组 = 未领养，前端据此走领养流程）
 * - POST /api/pets/adopt：起名 + 初始兴趣（默认给 ['科技','AI','互联网']，可改）；
 *   建 pets 行 + interests.json 种子
 *
 * 约束：
 * - 鉴权/租户范围与 data 路由同规矩（session claim + user_tenants 关系行 +
 *   TENANT_ID_RE；x-tenant-* 一律忽略）
 * - 幂等冲突：租户已有宠物 → 409 返回现有（当前 1 租户 1 宠物）
 * - 种子不覆盖：interests.json 已存在（租户已游荡）→ 只建宠物行不写种子
 * - 种子与 agent InterestGraphData schema 兼容（version 1 / weight 0.5 /
 *   source 'default'），agent load() 时标 initialized 不会重新 seedDefaults
 */

import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { and, eq } from 'drizzle-orm';
import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { pets, userTenants, type NewPet } from '../db/schema.js';
import { tenantDataDir } from '../tenant.js';
import { TENANT_ID_RE } from '../secrets/tenant-secrets.js';
import { resolveTenantFromRequest } from '../request-tenant.js';
import { isDiaryStyleChoice } from '@cyber-stray/shared/diary';
import {
  DEFAULT_PERSONALITY,
  getPersonality,
  isPersonalityId,
  parseCatchphraseList,
  type Catchphrase,
  type PersonalityId,
} from '@cyber-stray/shared';
import { openTenantSecrets } from '../secrets/tenant-secrets.js';
import { appendCatchphraseHistory } from '../catchphrase-history.js';
import { generateCandidates } from '../adoption/candidates.js';

export interface PetsDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'sessionSecret'>;
}

/** 默认初始兴趣（与 agent InterestGraph defaultSeeds 一致，可改防后悔） */
const DEFAULT_ADOPTION_INTERESTS = ['科技', 'AI', '互联网'];

/** 种子初始权重（与 agent seedDefaults 一致） */
const SEED_WEIGHT = 0.5;

/** 鉴权 + 租户校验：401 / 403 / { tenantId } */
async function scopedTenantId(
  req: Request,
  config: PetsDeps['config'],
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

const jsonError = (message: string) => ({ success: false, error: message });

/** 有效小时（0-23 整数；作息与 pushWindow 同为本地小时） */
function validHour(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23;
}

/** adopt 请求体 */
interface AdoptBody {
  name?: unknown;
  interests?: unknown;
  /** 性格（#90；可选，默认 DEFAULT_PERSONALITY） */
  personality?: unknown;
  /** 口头禅（#114；可选，默认 = 所选性格的默认组） */
  catchphrases?: unknown;
}

/** 校验 adopt 入参；返回 { name, interests, personality, catchphrases } 或错误消息 */
function parseAdoptBody(
  body: AdoptBody,
): {
  name: string;
  interests: string[];
  personality: PersonalityId;
  catchphrases: Catchphrase[];
} | { invalid: string } {
  const name = body.name;
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 32) {
    return { invalid: 'name 必填（1-32 字符）' };
  }
  let interests = DEFAULT_ADOPTION_INTERESTS;
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

/** DB catchphrases 列（JSON 字符串）→ 有效集合；NULL → 性格默认组 */
function parseStoredCatchphrases(
  stored: string | null,
  personality: string,
): Catchphrase[] {
  if (stored === null) return getPersonality(personality).catchphrases;
  return JSON.parse(stored) as Catchphrase[];
}

/**
 * 写兴趣种子（仅当文件不存在——不覆盖已游荡租户的图谱）。
 * 与 agent InterestGraphData schema 兼容。
 */
async function seedInterestsIfAbsent(
  dataDir: string,
  tenantId: string,
  interests: string[],
): Promise<void> {
  const seedPath = join(tenantDataDir(dataDir, tenantId), 'interests.json');
  try {
    await writeFile(
      seedPath,
      JSON.stringify(
        {
          version: 1,
          lastUpdated: new Date().toISOString(),
          nodes: interests.map((id) => ({
            id,
            weight: SEED_WEIGHT,
            source: 'default',
            createdAt: new Date().toISOString(),
            lastReinforced: new Date().toISOString(),
            reinforceCount: 0,
          })),
        },
        null,
        2,
      ),
      { flag: 'wx' }, // exclusive：已存在则失败（不覆盖）
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
    // 已存在（租户已游荡或已领养）→ 保留原文件
  }
}

export function createPetsRoutes({ config }: PetsDeps): Hono {
  const app = new Hono();

  /** GET /api/pets — 当前租户宠物列表 */
  app.get('/pets', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const db = await getDb(config.dataDir);
    const rows = await db.select().from(pets).where(eq(pets.tenantId, scoped.tenantId)).all();
    // S14 clean cutover：pets.plan 已废弃（套餐在 tenants），映射掉死列防契约失真。
    // #114：catchphrases 列 NULL（存量宠物）→ 性格默认组（有效集合始终可见）
    const data = rows.map(({ plan: _deprecated, catchphrases: stored, ...pet }) => ({
      ...pet,
      catchphrases: parseStoredCatchphrases(stored, pet.personality),
    }));
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

    const db = await getDb(config.dataDir);

    // 种子先行（非 EEXIST 失败时残留无害：重试的 wx 写会 EEXIST 复用；
    // 反过来行先落、种子失败重试会撞 409 且丢用户选的兴趣）
    await seedInterestsIfAbsent(config.dataDir, scoped.tenantId, parsed.interests);
    // #114：口头禅演化历史先行（insert 冲突 409 时多一行无害 trace）
    await appendCatchphraseHistory(
      tenantDataDir(config.dataDir, scoped.tenantId),
      'adopt',
      parsed.catchphrases,
    );

    const pet: NewPet = {
      id: randomUUID(),
      tenantId: scoped.tenantId,
      name: parsed.name,
      status: 'active',
      lastRunAt: null,
      cooldownUntil: null,
      lastBoostAt: null,
      // 就拉起首轮游荡（首推内容仍过 PushGate，门控理由随推送展示）
      boredom: 75,
      energy: 80,
      pushWindowStart: null,
      pushWindowEnd: null,
      sleepStart: null,
      sleepEnd: null,
      // #90：认领时选择性格（默认好奇；影响行为参数/语气/日记风格）
      personality: parsed.personality,
      // #114：口头禅（默认 = 性格默认组；显式存 JSON 而非 NULL，演化起点可追溯）
      catchphrases: JSON.stringify(parsed.catchphrases),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 原子幂等：tenant 唯一索引 + onConflictDoNothing（并发双 adopt 只赢一个）
    const inserted = await db
      .insert(pets)
      .values(pet)
      .onConflictDoNothing({ target: pets.tenantId })
      .run();
    if (inserted.rowsAffected === 0) {
      const existing = await db
        .select()
        .from(pets)
        .where(eq(pets.tenantId, scoped.tenantId))
        .get();
      if (!existing) return c.json(jsonError('已有宠物'), 409);
      const { catchphrases: stored, ...rest } = existing;
      return c.json(
        {
          success: false,
          error: '已有宠物',
          data: { ...rest, catchphrases: parseStoredCatchphrases(stored, existing.personality) },
        },
        409,
      );
    }

    const { catchphrases: _storedJson, ...petView } = pet;
    return c.json(
      { success: true, data: { ...petView, catchphrases: parsed.catchphrases } },
      201,
    );
  });

  /** PUT /api/pets/sleep-schedule — 设置作息（#91，本地小时；跨午夜合法） */
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

    const db = await getDb(config.dataDir);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, scoped.tenantId)).get();
    if (!pet) return c.json(jsonError('尚未领养宠物'), 409);

    await db
      .update(pets)
      .set({ sleepStart: body.startHour, sleepEnd: body.endHour })
      .where(eq(pets.tenantId, scoped.tenantId))
      .run();
    return c.json({
      success: true,
      data: { startHour: body.startHour, endHour: body.endHour },
    });
  });

  /** DELETE /api/pets/sleep-schedule — 清除作息（回永不睡眠，与现状一致） */
  app.delete('/pets/sleep-schedule', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }
    const db = await getDb(config.dataDir);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, scoped.tenantId)).get();
    if (!pet) return c.json(jsonError('尚未领养宠物'), 409);

    await db
      .update(pets)
      .set({ sleepStart: null, sleepEnd: null })
      .where(eq(pets.tenantId, scoped.tenantId))
      .run();
    return c.json({ success: true, data: { cleared: true } });
  });

  /** PUT /api/pets/diary-style — 设置日记风格（#92；'personality'=跟随性格） */
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

    const db = await getDb(config.dataDir);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, scoped.tenantId)).get();
    if (!pet) return c.json(jsonError('尚未领养宠物'), 409);

    await db
      .update(pets)
      .set({ diaryStyle })
      .where(eq(pets.tenantId, scoped.tenantId))
      .run();
    return c.json({ success: true, data: { diaryStyle } });
  });

  /** PUT /api/pets/diary-push — 设置是否推送每日日记（#92，Web Push） */
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

    const db = await getDb(config.dataDir);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, scoped.tenantId)).get();
    if (!pet) return c.json(jsonError('尚未领养宠物'), 409);

    await db
      .update(pets)
      .set({ diaryPushEnabled: body.enabled })
      .where(eq(pets.tenantId, scoped.tenantId))
      .run();
    return c.json({ success: true, data: { enabled: body.enabled } });
  });

  /**
   * POST /api/pets/adoption-candidates — 起名/口头禅步的 3 候选（#114 切片 3）。
   * LLM 一次返回；失败降级本地模板（仍 200，领养不阻塞）。API key：
   * 租户 BYOK secret 优先，平台 env 兜底（与 agent worker 同规则）。
   */
  app.post('/pets/adoption-candidates', async (c) => {
    const scoped = await scopedTenantId(c.req.raw, config);
    if ('error' in scoped) {
      return c.json(jsonError(scoped.error === 401 ? '未登录' : '无权访问该租户'), scoped.error);
    }

    let body: { step?: unknown; name?: unknown; personality?: unknown; batch?: unknown };
    try {
      body = await c.req.json() as typeof body;
    } catch {
      return c.json(jsonError('请求体须为 JSON'), 400);
    }
    if (body.step !== 'name' && body.step !== 'catchphrase') {
      return c.json(jsonError('step 须为 name|catchphrase'), 400);
    }
    if (body.step === 'catchphrase' && (typeof body.name !== 'string' || body.name.length === 0)) {
      return c.json(jsonError('catchphrase 步需要 name（候选依赖宠物名）'), 400);
    }
    if (
      body.step === 'catchphrase' &&
      (typeof body.personality !== 'string' || !isPersonalityId(body.personality))
    ) {
      return c.json(jsonError('catchphrase 步需要合法 personality'), 400);
    }
    if (body.batch !== undefined && (typeof body.batch !== 'number' || body.batch < 0 || body.batch > 3)) {
      return c.json(jsonError('batch 须为 0-3 的数字（换一批每步限 3 次）'), 400);
    }

    // API key：租户 secret 优先，env 兜底；无 key → generateCandidates 直接降级
    let apiKey = process.env.DEEPSEEK_API_KEY ?? '';
    try {
      const store = await openTenantSecrets(config.dataDir, scoped.tenantId);
      apiKey = (await store.get('deepseek_api_key')) ?? apiKey;
    } catch (error) {
      console.error('[adoption-candidates] 读取租户 secrets 失败，用平台 key：', error);
    }

    const result = await generateCandidates(
      {
        step: body.step,
        name: typeof body.name === 'string' ? body.name : undefined,
        personality: typeof body.personality === 'string' ? body.personality : undefined,
        batch: typeof body.batch === 'number' ? body.batch : 0,
      },
      apiKey,
    );
    return c.json({ success: true, data: result });
  });

  /** PUT /api/pets/catchphrases — 编辑口头禅集合（#114 切片 6；至少 1 条） */
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

    const db = await getDb(config.dataDir);
    const pet = await db.select().from(pets).where(eq(pets.tenantId, scoped.tenantId)).get();
    if (!pet) return c.json(jsonError('尚未领养宠物'), 409);

    await db
      .update(pets)
      .set({ catchphrases: JSON.stringify(parsed), updatedAt: Date.now() })
      .where(eq(pets.tenantId, scoped.tenantId))
      .run();
    await appendCatchphraseHistory(
      tenantDataDir(config.dataDir, scoped.tenantId),
      'settings',
      parsed,
    );
    return c.json({ success: true, data: { catchphrases: parsed } });
  });

  return app;
}
