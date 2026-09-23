/**
 * PetsService（应用层）——领养旅程与宠物设置的用例编排
 *
 * 职责：领养（种子 + 口头禅历史先行，宠物行原子幂等落库）、宠物列表
 * （含预算暂停初始态）、作息/日记风格/推送开关设置、领养候选（BYOK 优先）、
 * 口头禅编辑。存储在 infra/pets-repo，种子形状单一真相源在
 * shared/interest-graph，纯规则在 domain/。
 */

import { randomUUID } from 'crypto';
import type { Catchphrase, PersonalityId } from '@cyber-stray/shared';
import { getPersonality } from '@cyber-stray/shared';
import type { DiaryStyleChoice } from '@cyber-stray/shared/diary';
import { generateCandidates } from '../adoption/candidates.js';
import { appendCatchphraseHistory } from '../infra/catchphrase-history.js';
import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import type { NewPet } from '../db/schema.js';
import { seedInterestsIfAbsent } from '../infra/interest-seed-writer.js';
import * as petsRepo from '../infra/pets-repo.js';
import { findTenantPlan } from '../infra/tenant-access.js';
import { openTenantSecrets } from '../secrets/tenant-secrets.js';
import { planBudgetYuan, todayLlmCostYuan } from '../scheduler/budget.js';
import { localDateKey } from '../infra/usage.js';
import { tenantDataDir } from '../infra/tenant.js';

export interface PetsServiceDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'llmBudgetEnabled' | 'llmBudgetYuan'>;
}

/** adopt 用例的已校验入参（请求体校验在接口层完成） */
export interface AdoptInput {
  name: string;
  interests: string[];
  personality: PersonalityId;
  catchphrases: Catchphrase[];
}

export type PetsOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; status: 409; error: string; data?: unknown };

export function createPetsService({ config }: PetsServiceDeps) {
  /** DB catchphrases 列（JSON 字符串）→ 有效集合；NULL（存量宠物）→ 性格默认组 */
  function parseStoredCatchphrases(stored: string | null, personality: string): Catchphrase[] {
    if (stored === null) return getPersonality(personality).catchphrases;
    return JSON.parse(stored) as Catchphrase[];
  }

  /** 行 → API 视图：plan 死列映射掉（套餐已迁 tenants 表，防契约失真）+ 口头禅有效集合化 */
  function toPetView<T extends { plan?: unknown; catchphrases: string | null; personality: string }>(
    row: T,
  ) {
    const { plan: _deprecated, catchphrases: stored, ...pet } = row;
    return { ...pet, catchphrases: parseStoredCatchphrases(stored, row.personality) };
  }

  /** 409 守卫共用：后续操作都要求租户已有宠物 */
  async function requirePet(tenantId: string) {
    const db = await getDb(config.dataDir);
    const pet = await petsRepo.findPetByTenant(db, tenantId);
    if (!pet) return { ok: false as const, status: 409 as const, error: '尚未领养宠物' };
    return { ok: true as const, pet };
  }

  /** 当前租户宠物列表 + 预算暂停初始态（SSE 不重放，刷新后靠这里与调度闸同一判定） */
  async function listPets(tenantId: string) {
    const db = await getDb(config.dataDir);
    const rows = await petsRepo.findPetsByTenant(db, tenantId);
    const data = rows.map(toPetView);
    // 与调度闸同一判定（budget.ts 单一实现）；读失败显式 500，不静默当没超
    const plan = (await findTenantPlan(config.dataDir, tenantId)) ?? 'free';
    const budgetLimit = planBudgetYuan(
      { enabled: config.llmBudgetEnabled, yuanPerPlan: config.llmBudgetYuan },
      plan,
    );
    const budgetPaused =
      budgetLimit !== null &&
      (await todayLlmCostYuan(config.dataDir, tenantId, localDateKey())) >= budgetLimit;
    return data.map((pet) => ({ ...pet, budgetPaused }));
  }

  /** 领养：种子先行（非 EEXIST 失败残留无害，重试的 wx 写会复用；反过来行先落、
   * 种子失败重试会撞 409 且丢用户选的兴趣），口头禅演化历史先行同理 */
  async function adopt(tenantId: string, input: AdoptInput): Promise<PetsOutcome<unknown>> {
    await seedInterestsIfAbsent(config.dataDir, tenantId, input.interests);
    await appendCatchphraseHistory(
      tenantDataDir(config.dataDir, tenantId),
      'adopt',
      input.catchphrases,
    );

    const db = await getDb(config.dataDir);
    const pet: NewPet = {
      id: randomUUID(),
      tenantId,
      name: input.name,
      status: 'active',
      lastRunAt: null,
      cooldownUntil: null,
      lastBoostAt: null,
      // 初始值即拉起首轮游荡（首推内容仍过推送门控）
      boredom: 75,
      energy: 80,
      // 数值归库（ADR-0013，禁兜底）：初始心情/脾气与 agent createDefaultState 对齐，
      // 调度注入从此恒有值（null 只存在于待迁移的存量行）
      mood: 'curious',
      temper: 20,
      pushWindowStart: null,
      pushWindowEnd: null,
      sleepStart: null,
      sleepEnd: null,
      // 认领时选择性格（默认好奇；影响行为参数/语气/日记风格）
      personality: input.personality,
      // 口头禅显式存 JSON 而非 NULL：演化起点可追溯
      catchphrases: JSON.stringify(input.catchphrases),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const inserted = await petsRepo.insertPetAdopting(db, pet);
    if (inserted.rowsAffected === 0) {
      const existing = await petsRepo.findPetByTenant(db, tenantId);
      if (!existing) return { ok: false, status: 409, error: '已有宠物' };
      // 409 带现有宠物：前端据此直接进入已领养态
      return { ok: false, status: 409, error: '已有宠物', data: toPetView(existing) };
    }

    const { catchphrases: _storedJson, ...petView } = pet;
    return { ok: true, data: { ...petView, catchphrases: input.catchphrases } };
  }

  async function setSleepSchedule(tenantId: string, startHour: number, endHour: number) {
    const guard = await requirePet(tenantId);
    if (!guard.ok) return guard;
    const db = await getDb(config.dataDir);
    await petsRepo.updateSleepSchedule(db, tenantId, startHour, endHour);
    return { ok: true as const, data: { startHour, endHour } };
  }

  async function clearSleepSchedule(tenantId: string) {
    const guard = await requirePet(tenantId);
    if (!guard.ok) return guard;
    const db = await getDb(config.dataDir);
    await petsRepo.clearSleepSchedule(db, tenantId);
    return { ok: true as const, data: { cleared: true } };
  }

  async function setDiaryStyle(tenantId: string, diaryStyle: DiaryStyleChoice) {
    const guard = await requirePet(tenantId);
    if (!guard.ok) return guard;
    const db = await getDb(config.dataDir);
    await petsRepo.updateDiaryStyle(db, tenantId, diaryStyle);
    return { ok: true as const, data: { diaryStyle } };
  }

  async function setDiaryPush(tenantId: string, enabled: boolean) {
    const guard = await requirePet(tenantId);
    if (!guard.ok) return guard;
    const db = await getDb(config.dataDir);
    await petsRepo.updateDiaryPush(db, tenantId, enabled);
    return { ok: true as const, data: { enabled } };
  }

  async function updateCatchphrases(tenantId: string, catchphrases: Catchphrase[]) {
    const guard = await requirePet(tenantId);
    if (!guard.ok) return guard;
    const db = await getDb(config.dataDir);
    await petsRepo.updateCatchphrases(db, tenantId, catchphrases);
    await appendCatchphraseHistory(tenantDataDir(config.dataDir, tenantId), 'settings', catchphrases);
    return { ok: true as const, data: { catchphrases } };
  }

  /**
   * 起名/口头禅步的 3 候选。API key：租户 BYOK secret 优先，平台 env 兜底
   * （secrets 读取失败显式抛错——平台 key 不能替 BYOK 租户静默代付 LLM 成本）。
   * 生成失败降级本地模板（仍 200，领养不阻塞）。
   */
  async function adoptionCandidates(
    tenantId: string,
    input: {
      step: 'name' | 'catchphrase';
      name?: string;
      /** 路由层已过 isPersonalityId 校验；此处保持 string 以对齐候选生成器签名 */
      personality?: string;
      batch: number;
    },
  ) {
    let apiKey = process.env.DEEPSEEK_API_KEY ?? '';
    const store = await openTenantSecrets(config.dataDir, tenantId);
    apiKey = (await store.get('deepseek_api_key')) ?? apiKey;
    return generateCandidates(input, apiKey);
  }

  return {
    listPets,
    adopt,
    setSleepSchedule,
    clearSleepSchedule,
    setDiaryStyle,
    setDiaryPush,
    updateCatchphrases,
    adoptionCandidates,
  };
}

export type PetsService = ReturnType<typeof createPetsService>;
