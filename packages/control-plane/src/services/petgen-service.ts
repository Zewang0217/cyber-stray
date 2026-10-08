/**
 * PetGenService（应用层）——宠物 IP 自定义生成的用户面用例
 *
 * 提交/重启（配额拦截 + 状态机入口校验）、查询、概念图确认、素材读取。
 * 状态机的推进由 PetGenProcessor tick 负责（独立模块），本服务只管
 * 用户面入口的状态转移门槛。存储在 infra/petgen-repo，配额策略在
 * petgen/quota，Pro/BYOK 专属判定在此层（账号层字段）。
 */

import { randomUUID } from 'crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import {
  DEFAULT_PET_PRESET,
  PET_STATE_IDS,
  PET_SHEET_STATE_IDS,
  type PetPresetId,
  type PetStateId,
} from '@cyber-stray/shared/pet';
import { getPersonality, type PersonalityId } from '@cyber-stray/shared';
import { parseStoredQcResult, type PetGenQuota, type PetGenTaskView } from '@cyber-stray/shared/petgen';
import type { ControlPlaneConfig } from '../config.js';
import type { ControlDb } from '../db/client.js';
import { getDb } from '../db/client.js';
import type { PetGenTask } from '../db/schema.js';
import { petGenTasks } from '../db/schema.js';
import { and, eq, inArray } from 'drizzle-orm';
import { IN_FLIGHT, taskDirOf } from '../petgen/processor.js';
import * as petgenRepo from '../infra/petgen-repo.js';
import { readTenantAsset } from '../infra/tenant-data-reader.js';
import { findTenantById, findTenantPlan } from '../infra/tenant-access.js';
import { petGenWeeklyQuota } from '../petgen/quota.js';
import { parseTenantQuotaOverrides } from '@cyber-stray/shared/quota';
import { isAdminSub } from '../infra/admin-repo.js';
import type { PetSpec } from '../petgen/types.js';
import { createSplitter } from '../petgen/splitter.js';
import { tenantDataDir } from '../infra/tenant.js';
import { canRetryPetGenQc } from '../domain/petgen-failure.js';
import { resolveEntitlements } from '../plan/entitlements.js';

export interface PetGenServiceDeps {
  /** 经过 session 验证的用户身份；管理员权限不从 tenantId 推断。 */
  principalSub: string;
  config: Pick<ControlPlaneConfig, 'dataDir' | 'productMode'> & Partial<Pick<ControlPlaneConfig, 'adminSubs'>>;
}

export type PetGenOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; status: 403 | 404 | 409 | 429; error: string; data?: unknown };

/**
 * 同租户任务提交串行化（进程内）：hasInFlightTask（SELECT）与 insertTask
 * （INSERT）之间有多个 await，两个并发提交（领养自动建任务 × 改造屋手动
 * 提交、双击提交）可同时通过在飞检查后各自插入——nextDueTask 只推进
 * 「租户恰 1 个在飞」的任务，届时两个任务永久互卡且无取消端点，只能手工
 * 改库恢复。CP 当前单实例，进程内串行即可闭合该窗口；未来多实例横向扩展
 * 需升级为 DB 层部分唯一索引（tenant_id WHERE status IN 在飞集）。
 */
const submitQueues = new Map<string, Promise<unknown>>();

/** 串行执行同租户的提交（check-then-insert 原子化）；前序失败不阻断本任务 */
function serializedSubmit<T>(tenantId: string, submit: () => Promise<T>): Promise<T> {
  const prev = submitQueues.get(tenantId) ?? Promise.resolve();
  const run = prev.then(submit);
  const settled = run.catch(() => undefined);
  submitQueues.set(tenantId, settled);
  void settled.then(() => {
    if (submitQueues.get(tenantId) === settled) submitQueues.delete(tenantId);
  });
  return run;
}

/** 领养参考图压平边长（与管线 referenceFrame 同水位；白底 JPEG 供 Seedream img2img） */
const ADOPT_REFERENCE_FRAME = 384;

/** 领养外观的已校验入参（领养路由的 AdoptInput 原语子集，避免跨 service 类型耦合） */
export interface AdoptAppearanceInput {
  name: string;
  interests: string[];
  personality: string;
}

/**
 * 领养属性 → 九态形象 spec（确定性模板；风格锁 pixel——街角是像素宇宙，
 * 用户参考图作为角色锚点转绘为像素角色）。
 */
export function buildAdoptAppearanceSpec(input: AdoptAppearanceInput): PetSpec {
  const personality = getPersonality(input.personality as PersonalityId);
  return {
    specText:
      `精致可爱的游戏吉祥物，完整全身，无文字、边框或背景道具。参考图优先保留角色外观；无参考图时是一只圆头短腿的小猫。主人领养的宠物「${input.name}」,性格${personality.name}(${personality.description}),` +
      `对${input.interests.join('、')}感兴趣`,
    stylePreset: 'pixel',
  };
}

/** 任务 → API 视图（去掉内部列，附概念图/素材 URL） */
function toTaskView(task: PetGenTask): PetGenTaskView {
  return {
    id: task.id,
    status: task.status,
    specText: task.specText,
    options: task.options ? (JSON.parse(task.options) as PetSpec['options']) : undefined,
    stylePreset: (task.stylePreset ?? DEFAULT_PET_PRESET) as PetPresetId,
    conceptUrl: task.conceptPath ? `/api/petgen/tasks/${task.id}/concept.png` : null,
    error: task.error,
    canRetryQc: canRetryPetGenQc(task),
    qcResult: task.qcResult ? parseStoredQcResult(task.qcResult) : null,
    conceptAttempts: task.conceptAttempts,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    assetBase: task.status === 'done' ? '/api/petgen/assets' : null,
  };
}

export function createPetGenService({ config, principalSub }: PetGenServiceDeps) {
  /** 所有生成入口共享配额；admin 例外以 RBAC 身份为准，租户覆盖 0 = 不限与其同效。 */
  async function generationQuota(db: ControlDb, tenantId: string) {
    const overrides = parseTenantQuotaOverrides(
      (await findTenantById(config.dataDir, tenantId))?.quotaOverrides,
    );
    const limit = overrides?.petgenWeeklyLimit ?? 1;
    const unlimited = limit === 0
      || (await isAdminSub(config.dataDir, principalSub, config.adminSubs ?? []));
    return petGenWeeklyQuota(db, tenantId, unlimited, Date.now(), limit);
  }

  /** 租户套餐是否可用 IP 定制（Pro/BYOK 专属；免费无入口） */
  async function planAllowed(db: ControlDb, tenantId: string): Promise<boolean> {
    const { plan } = resolveEntitlements(await findTenantPlan(config.dataDir, tenantId), config.productMode);
    return plan === 'pro' || plan === 'byok';
  }

  /** 套餐闸前置校验（保持旧实现顺序：plan 403 先于请求体 400，免费用户不泄露参数校验细节）；null = 通过 */
  async function ensureProPlan(tenantId: string): Promise<{ ok: false; status: 403; error: string } | null> {
    const db = await getDb(config.dataDir);
    if (!(await planAllowed(db, tenantId))) {
      return { ok: false, status: 403, error: '宠物 IP 定制是 Pro/BYOK 专属功能' };
    }
    return null;
  }

  /** 租户是否有在飞生成任务（并发提交拒绝用——在飞集合与推进器同源 IN_FLIGHT） */
  async function hasInFlightTask(db: ControlDb, tenantId: string, includeConfirmation = false): Promise<boolean> {
    const rows = await db
      .select({ id: petGenTasks.id })
      .from(petGenTasks)
      .where(and(eq(petGenTasks.tenantId, tenantId), inArray(petGenTasks.status, includeConfirmation ? [...IN_FLIGHT, 'awaiting_confirmation'] : IN_FLIGHT)))
      .limit(1);
    return rows.length > 0;
  }

  /** 提交 spec（Pro/BYOK 专属 + 配额拦截；失败任务不占配额——只统计 done） */
  async function submitTask(
    tenantId: string,
    spec: PetSpec,
  ): Promise<PetGenOutcome<ReturnType<typeof toTaskView>>> {
    const db = await getDb(config.dataDir);
    if (!(await planAllowed(db, tenantId))) {
      return { ok: false, status: 403, error: '宠物 IP 定制是 Pro/BYOK 专属功能' };
    }
    // 在飞检查 + 插入必须串行（见 serializedSubmit 注释：并发双插入 = 队列互卡）
    return serializedSubmit(tenantId, async () => {
      if (await hasInFlightTask(db, tenantId, true)) {
        return { ok: false, status: 409, error: '已有生成任务进行中，完成后再提交' };
      }
      const quota = await generationQuota(db, tenantId);
      if (quota.remaining === 0) {
        return {
          ok: false,
          status: 429,
          error: '每七天可生成一套外观，请在下次可用时间后重试',
          data: quota,
        };
      }
      const task: PetGenTask = {
        id: randomUUID(),
        tenantId,
        status: 'spec_submitted',
        specText: spec.specText,
        options: spec.options ? JSON.stringify(spec.options) : null,
        stylePreset: spec.stylePreset ?? null,
        conceptPath: null,
        strategy: 'quad' as const,
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
      await petgenRepo.insertTask(db, task);
      return { ok: true, data: toTaskView(task) };
    });
  }

  /**
   * 领养九态任务（adopt 自动确认后复用改造屋经典管线；首测放开套餐门——领养是全员首跑体验，
   * 但仍占同一份七天生成额度：配额耗尽 = 不建任务，生成开始前显示内置猫）。
   * 调用方（领养路由）best-effort 提交，失败不阻塞领养。
   */
  async function submitAdoptTask(
    tenantId: string,
    spec: PetSpec,
  ): Promise<{ ok: true; taskId: string } | { ok: false; reason: 'quota' | 'busy' }> {
    const db = await getDb(config.dataDir);
    // 并发拒绝 + 插入串行化（同 submitTask）：改造屋任务在飞时领养不叠任务，防互卡
    return serializedSubmit(tenantId, async () => {
      if (await hasInFlightTask(db, tenantId, true)) return { ok: false, reason: 'busy' };
      const quota = await generationQuota(db, tenantId);
      if (quota.remaining === 0) return { ok: false, reason: 'quota' };
      const task: PetGenTask = {
        id: randomUUID(),
        tenantId,
        status: 'spec_submitted',
        specText: spec.specText,
        options: spec.options ? JSON.stringify(spec.options) : null,
        stylePreset: spec.stylePreset ?? 'pixel',
        conceptPath: null,
        strategy: 'adopt',
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
      await petgenRepo.insertTask(db, task);
      return { ok: true, taskId: task.id };
    });
  }

  /**
   * 领养参考图落盘：原始字节 → pet-sheet.py 压白底 JPEG（顺带校验可解析性，
   * 坏图在 upload 时显式失败而非管线中途爆）。canonical 固定名
   * adopt-reference.jpg（覆盖语义：重新上传即替换），处理器按此名取用。
   */
  async function saveAdoptReference(tenantId: string, bytes: Buffer): Promise<void> {
    const assetsDir = join(tenantDataDir(config.dataDir, tenantId), 'pet-assets');
    await mkdir(assetsDir, { recursive: true });
    const rawPath = join(assetsDir, 'adopt-reference-raw');
    await writeFile(rawPath, bytes);
    try {
      await createSplitter().flattenReference(
        rawPath,
        join(assetsDir, 'adopt-reference.jpg'),
        ADOPT_REFERENCE_FRAME,
      );
    } finally {
      // 中间产物清理；清理失败不影响主流程（无扩展名 → 素材白名单不会外泄此文件）
      await rm(rawPath, { force: true }).catch(() => { });
    }
  }

  /** Project retry eligibility from the same gates used by the retry command. */
  async function verifiedTaskView(db: ControlDb, task: PetGenTask): Promise<PetGenTaskView> {
    const view = toTaskView(task);
    if (!view.canRetryQc) return view;
    const sheet = task.strategy === 'sheet' || task.strategy === 'strip';
    const allowed = sheet || await planAllowed(db, task.tenantId);
    const quota = await generationQuota(db, task.tenantId);
    view.canRetryQc = allowed && (quota.unlimited || quota.remaining === 1) &&
      !(await hasInFlightTask(db, task.tenantId)) && await hasQcAssets(task);
    return view;
  }

  async function listTasks(tenantId: string) {
    const db = await getDb(config.dataDir);
    const rows = await petgenRepo.listTasksByTenant(db, tenantId);
    return Promise.all(rows.map((task) => verifiedTaskView(db, task)));
  }

  /** 任务详情（租户隔离：他人任务 404） */
  async function getTask(tenantId: string, id: string) {
    const db = await getDb(config.dataDir);
    const task = await petgenRepo.findTaskByIdAndTenant(db, id, tenantId);
    return task ? verifiedTaskView(db, task) : null;
  }

  async function confirmTask(tenantId: string, id: string): Promise<PetGenOutcome<unknown>> {
    const db = await getDb(config.dataDir);
    return serializedSubmit(tenantId, async () => {
      const task = await petgenRepo.findTaskByIdAndTenant(db, id, tenantId);
      if (!task) return { ok: false, status: 404, error: '任务不存在' };
      if (task.status !== 'awaiting_confirmation') {
        return {
          ok: false,
          status: 409,
          error: `当前状态 ${task.status} 不可确认（需等待概念图确认）`,
        };
      }
      if (await hasInFlightTask(db, tenantId)) {
        return { ok: false, status: 409, error: '已有生成任务进行中，完成后再确认' };
      }
      const quota = await generationQuota(db, tenantId);
      if (quota.remaining === 0) {
        return { ok: false, status: 429, error: '每七天可生成一套外观，请在下次可用时间后重试', data: quota };
      }
      const confirmed = { ...task, status: 'generating_states' as const, updatedAt: Date.now() };
      await petgenRepo.updateTask(db, task.id, { status: confirmed.status, updatedAt: confirmed.updatedAt });
      return { ok: true, data: toTaskView(confirmed) };
    });
  }

  /** Missing retained images are a conflict; I/O failures remain explicit errors. */
  async function hasQcAssets(task: PetGenTask): Promise<boolean> {
    const sheet = task.strategy === 'sheet' || task.strategy === 'strip';
    const root = taskDirOf(config.dataDir, task.tenantId, task.id);
    const states = sheet ? PET_SHEET_STATE_IDS : PET_STATE_IDS;
    const paths = [join(root, sheet ? 'reference.jpg' : 'concept.png'),
      ...states.map((state) => join(root, 'states', `${state}.png`))];
    const present = await Promise.all(paths.map(async (path) => {
      try { return (await stat(path)).isFile(); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    }));
    return present.every(Boolean);
  }

  /** Resume infrastructure-failed QC without another concept/image charge. */
  async function retryQcTask(tenantId: string, id: string): Promise<PetGenOutcome<PetGenTaskView>> {
    const db = await getDb(config.dataDir);
    return serializedSubmit(tenantId, async () => {
      const task = await petgenRepo.findTaskByIdAndTenant(db, id, tenantId);
      if (!task) return { ok: false, status: 404, error: '任务不存在' };
      const sheet = task.strategy === 'sheet' || task.strategy === 'strip';
      // Sheet adoption is already available to free tenants; its recovery must be too.
      if (!sheet && !(await planAllowed(db, tenantId))) {
        return { ok: false, status: 403, error: '宠物 IP 定制是 Pro/BYOK 专属功能' };
      }
      if (!canRetryPetGenQc(task)) {
        return { ok: false, status: 409, error: '仅质检服务异常的失败任务可重试质检' };
      }
      if (await hasInFlightTask(db, tenantId)) {
        return { ok: false, status: 409, error: '已有生成任务进行中，完成后再重试' };
      }
      const quota = await generationQuota(db, tenantId);
      if (quota.remaining === 0) {
        return { ok: false, status: 429, error: '每七天可生成一套外观，请在下次可用时间后重试', data: quota };
      }
      if (!(await hasQcAssets(task))) {
        return { ok: false, status: 409, error: '已生成素材不完整，无法仅重试质检' };
      }
      const resumed = { ...task, status: 'qc' as const, error: null,
        completedAt: null, updatedAt: Date.now() };
      await petgenRepo.updateTask(db, id, {
        status: resumed.status, error: null, completedAt: null, updatedAt: resumed.updatedAt,
      });
      return { ok: true, data: toTaskView(resumed) };
    });
  }

  /** 不满意：改 spec 重出概念图。重启也是一次生成尝试——配额超限同样拦截（防绕过） */
  async function restartTask(tenantId: string, id: string, spec: PetSpec): Promise<PetGenOutcome<unknown>> {
    const db = await getDb(config.dataDir);
    return serializedSubmit(tenantId, async () => {
      const task = await petgenRepo.findTaskByIdAndTenant(db, id, tenantId);
      if (!task) return { ok: false, status: 404, error: '任务不存在' };
      if (task.strategy === 'sheet' || task.strategy === 'strip') {
        // 领养外观任务不在改造屋 UI 出现，误触 restart 会把策略打回 quad 破坏素材形状
        return { ok: false, status: 409, error: '领养外观任务不支持改 spec 重来' };
      }
      if (task.status !== 'awaiting_confirmation' && task.status !== 'failed') {
        return {
          ok: false,
          status: 409,
          error: `当前状态 ${task.status} 不可重来（仅等待确认/失败后可改 spec）`,
        };
      }
      if (await hasInFlightTask(db, tenantId)) {
        return { ok: false, status: 409, error: '已有生成任务进行中，完成后再重来' };
      }
      const quota = await generationQuota(db, tenantId);
      if (quota.remaining === 0) {
        return { ok: false, status: 429, error: '每七天可生成一套外观，请在下次可用时间后重试', data: quota };
      }
      const restarted = {
        specText: spec.specText,
        options: spec.options ? JSON.stringify(spec.options) : null,
        stylePreset: spec.stylePreset ?? null,
        status: 'spec_submitted' as const,
        conceptPath: null,
        strategy: 'quad' as const,
        batchRetries: 0,
        qcRetries: 0,
        qcResult: null,
        pendingStates: null,
        error: null,
        completedAt: null,
        updatedAt: Date.now(),
      };
      await petgenRepo.updateTask(db, task.id, restarted);
      return { ok: true, data: toTaskView({ ...task, ...restarted }) };
    });
  }

  /** 概念图草稿字节（确认流展示）；任务/文件不存在 → null */
  async function getConceptPng(tenantId: string, id: string): Promise<Buffer | null> {
    const db = await getDb(config.dataDir);
    const task = await petgenRepo.findTaskByIdAndTenant(db, id, tenantId);
    if (!task || !task.conceptPath) return null;
    try {
      return await readFile(join(tenantDataDir(config.dataDir, tenantId), task.conceptPath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** 每七天一次；管理员不限次。 */
  async function getQuota(tenantId: string): Promise<PetGenQuota> {
    const db = await getDb(config.dataDir);
    if (!(await planAllowed(db, tenantId))) {
      return { period: 'rolling_week', unlimited: false, limit: 0, used: 0, remaining: 0, resetAt: null, available: false };
    }
    const quota = await generationQuota(db, tenantId);
    return {
      ...quota,
      available: true,
    };
  }

  /** 成品素材字节（manifest + 状态 PNG，租户私有）；缺失 → null */
  async function getAsset(tenantId: string, file: string) {
    const bytes = await readTenantAsset(config.dataDir, tenantId, file);
    if (!bytes) return null;
    return { bytes, contentType: file.endsWith('.json') ? 'application/json' : 'image/png' };
  }

  /**
   * 领养 side effect：best-effort 建精灵图任务。领养不阻塞策略在此收口——
   * 配额耗尽/提交失败只记日志，调用方（路由）await 一次毫秒级 DB 写，
   * 真正的生图在 petgen 异步队列推进。
   */
  async function adoptAppearanceSideEffect(tenantId: string, input: AdoptAppearanceInput): Promise<void> {
    try {
      const outcome = await submitAdoptTask(tenantId, buildAdoptAppearanceSpec(input));
      if (!outcome.ok) {
        const why = outcome.reason === 'busy' ? '已有生成任务在飞' : '配额耗尽';
        console.warn(`[pets] 领养外观跳过生成：${why}（租户 ${tenantId}）`);
      }
    } catch (error) {
      console.error(`[pets] 领养外观任务提交失败（租户 ${tenantId}）：`, error);
    }
  }

  return {
    submitTask,
    submitAdoptTask,
    saveAdoptReference,
    adoptAppearanceSideEffect,
    ensureProPlan,
    listTasks,
    getTask,
    confirmTask,
    retryQcTask,
    restartTask,
    getConceptPng,
    getQuota,
    getAsset,
  };
}

export type PetGenService = ReturnType<typeof createPetGenService>;
