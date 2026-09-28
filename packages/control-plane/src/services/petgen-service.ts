/**
 * PetGenService（应用层）——宠物 IP 自定义生成的用户面用例
 *
 * 提交/重启（配额拦截 + 状态机入口校验）、查询、概念图确认、素材读取。
 * 状态机的推进由 PetGenProcessor tick 负责（独立模块），本服务只管
 * 用户面入口的状态转移门槛。存储在 infra/petgen-repo，配额策略在
 * petgen/quota，Pro/BYOK 专属判定在此层（账号层字段）。
 */

import { randomUUID } from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import {
  DEFAULT_PET_PRESET,
  type PetPresetId,
  type PetStateId,
} from '@cyber-stray/shared/pet';
import { getPersonality, type PersonalityId } from '@cyber-stray/shared';
import type { PetGenQuota, PetGenTaskView, StateQcResult } from '@cyber-stray/shared/petgen';
import type { ControlPlaneConfig } from '../config.js';
import type { ControlDb } from '../db/client.js';
import { getDb } from '../db/client.js';
import type { PetGenTask } from '../db/schema.js';
import * as petgenRepo from '../infra/petgen-repo.js';
import { readTenantAsset } from '../infra/tenant-data-reader.js';
import { findTenantPlan } from '../infra/tenant-access.js';
import { nextMonthStart, petGenQuota } from '../petgen/quota.js';
import type { PetSpec, PetGenTaskStatus } from '../petgen/types.js';
import { createSplitter } from '../petgen/splitter.js';
import { tenantDataDir } from '../infra/tenant.js';

export interface PetGenServiceDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'petGenMonthlyQuota'>;
}

export type PetGenOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; status: 403 | 404 | 409 | 429; error: string; data?: unknown };

/** 领养参考图压平边长（与管线 referenceFrame 同水位；白底 JPEG 供 Seedream img2img） */
const ADOPT_REFERENCE_FRAME = 384;

/** 领养精灵图的已校验入参（领养路由的 AdoptInput 原语子集，避免跨 service 类型耦合） */
export interface AdoptSheetInput {
  name: string;
  interests: string[];
  personality: string;
}

/**
 * 领养属性 → 精灵图 spec（确定性模板；风格锁 pixel——街角是像素宇宙，
 * 用户参考图经 img2img 转绘为像素精灵）。
 */
export function buildAdoptSheetSpec(input: AdoptSheetInput): PetSpec {
  const personality = getPersonality(input.personality as PersonalityId);
  return {
    specText:
      `主人领养的宠物「${input.name}」,性格${personality.name}(${personality.description}),` +
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
    qcResult: task.qcResult ? (JSON.parse(task.qcResult) as Record<PetStateId, StateQcResult>) : null,
    conceptAttempts: task.conceptAttempts,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    assetBase: task.status === 'done' ? '/api/petgen/assets' : null,
  };
}

export function createPetGenService({ config }: PetGenServiceDeps) {
  /** 租户套餐是否可用 IP 定制（Pro/BYOK 专属；免费无入口） */
  async function planAllowed(db: ControlDb, tenantId: string): Promise<boolean> {
    const plan = await findTenantPlan(config.dataDir, tenantId);
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

  /** 提交 spec（Pro/BYOK 专属 + 配额拦截；失败任务不占配额——只统计 done） */
  async function submitTask(
    tenantId: string,
    spec: PetSpec,
  ): Promise<PetGenOutcome<ReturnType<typeof toTaskView>>> {
    const db = await getDb(config.dataDir);
    if (!(await planAllowed(db, tenantId))) {
      return { ok: false, status: 403, error: '宠物 IP 定制是 Pro/BYOK 专属功能' };
    }
    const quota = await petGenQuota(db, tenantId, config.petGenMonthlyQuota);
    if (quota.remaining <= 0) {
      return {
        ok: false,
        status: 429,
        error: `本月配额已用完（${quota.limit} 套/月），下月 ${new Date(nextMonthStart(Date.now())).toISOString().slice(0, 7)} 重置`,
        data: { ...quota, resetAt: new Date(nextMonthStart(Date.now())).toISOString().slice(0, 7) },
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
    await petgenRepo.insertTask(db, task);
    return { ok: true, data: toTaskView(task) };
  }

  /**
   * 领养精灵图任务（sheet 策略；首测放开套餐门——领养是全员首跑体验，
   * 但仍占同一份月度配额：配额耗尽 = 不建任务，领养以内置猫上岗）。
   * 调用方（领养路由）best-effort 提交，失败不阻塞领养。
   */
  async function submitAdoptSheetTask(
    tenantId: string,
    spec: PetSpec,
  ): Promise<{ ok: true; taskId: string } | { ok: false; reason: 'quota' }> {
    const db = await getDb(config.dataDir);
    const quota = await petGenQuota(db, tenantId, config.petGenMonthlyQuota);
    if (quota.remaining <= 0) return { ok: false, reason: 'quota' };
    const task: PetGenTask = {
      id: randomUUID(),
      tenantId,
      status: 'spec_submitted',
      specText: spec.specText,
      options: spec.options ? JSON.stringify(spec.options) : null,
      stylePreset: spec.stylePreset ?? 'pixel',
      conceptPath: null,
      strategy: 'sheet',
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

  async function listTasks(tenantId: string) {
    const db = await getDb(config.dataDir);
    const rows = await petgenRepo.listTasksByTenant(db, tenantId);
    return rows.map(toTaskView);
  }

  /** 任务详情（租户隔离：他人任务 404） */
  async function getTask(tenantId: string, id: string) {
    const db = await getDb(config.dataDir);
    const task = await petgenRepo.findTaskByIdAndTenant(db, id, tenantId);
    return task ? toTaskView(task) : null;
  }

  async function confirmTask(tenantId: string, id: string): Promise<PetGenOutcome<unknown>> {
    const db = await getDb(config.dataDir);
    const task = await petgenRepo.findTaskByIdAndTenant(db, id, tenantId);
    if (!task) return { ok: false, status: 404, error: '任务不存在' };
    if (task.status !== 'awaiting_confirmation') {
      return {
        ok: false,
        status: 409,
        error: `当前状态 ${task.status} 不可确认（需等待概念图确认）`,
      };
    }
    await petgenRepo.updateTask(db, task.id, { status: 'generating_states', updatedAt: Date.now() });
    return { ok: true, data: toTaskView({ ...task, status: 'generating_states' }) };
  }

  /** 不满意：改 spec 重出概念图。重启也是一次生成尝试——配额超限同样拦截（防绕过） */
  async function restartTask(tenantId: string, id: string, spec: PetSpec): Promise<PetGenOutcome<unknown>> {
    const db = await getDb(config.dataDir);
    const task = await petgenRepo.findTaskByIdAndTenant(db, id, tenantId);
    if (!task) return { ok: false, status: 404, error: '任务不存在' };
    if (task.strategy === 'sheet' || task.strategy === 'strip') {
      // 领养精灵图任务不在改造屋 UI 出现，误触 restart 会把策略打回 quad 破坏素材形状
      return { ok: false, status: 409, error: '领养精灵图任务不支持改 spec 重来' };
    }
    if (task.status !== 'awaiting_confirmation' && task.status !== 'failed') {
      return {
        ok: false,
        status: 409,
        error: `当前状态 ${task.status} 不可重来（仅等待确认/失败后可改 spec）`,
      };
    }
    const quota = await petGenQuota(db, tenantId, config.petGenMonthlyQuota);
    if (quota.remaining <= 0) {
      return { ok: false, status: 429, error: '本月配额已用完', data: quota };
    }
    await petgenRepo.updateTask(db, task.id, {
      specText: spec.specText,
      options: spec.options ? JSON.stringify(spec.options) : null,
      stylePreset: spec.stylePreset ?? null,
      status: 'spec_submitted' as PetGenTaskStatus,
      conceptPath: null,
      strategy: 'quad',
      batchRetries: 0,
      qcRetries: 0,
      qcResult: null,
      pendingStates: null,
      error: null,
      completedAt: null,
      updatedAt: Date.now(),
    });
    const updated = await petgenRepo.findTaskByIdAndTenant(db, id, tenantId);
    return { ok: true, data: toTaskView(updated ?? task) };
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

  /** 本月配额（非 Pro/BYOK → available:false 全 0） */
  async function getQuota(tenantId: string): Promise<PetGenQuota> {
    const db = await getDb(config.dataDir);
    if (!(await planAllowed(db, tenantId))) {
      return { limit: 0, used: 0, remaining: 0, available: false };
    }
    const quota = await petGenQuota(db, tenantId, config.petGenMonthlyQuota);
    return {
      ...quota,
      available: true,
      resetAt: new Date(nextMonthStart(Date.now())).toISOString().slice(0, 7),
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
  async function adoptSheetSideEffect(tenantId: string, input: AdoptSheetInput): Promise<void> {
    try {
      const outcome = await submitAdoptSheetTask(tenantId, buildAdoptSheetSpec(input));
      if (!outcome.ok) {
        console.warn(`[pets] 领养精灵图配额耗尽，跳过生成（租户 ${tenantId}）`);
      }
    } catch (error) {
      console.error(`[pets] 领养精灵图任务提交失败（租户 ${tenantId}）：`, error);
    }
  }

  return {
    submitTask,
    submitAdoptSheetTask,
    saveAdoptReference,
    adoptSheetSideEffect,
    ensureProPlan,
    listTasks,
    getTask,
    confirmTask,
    restartTask,
    getConceptPng,
    getQuota,
    getAsset,
  };
}

export type PetGenService = ReturnType<typeof createPetGenService>;
