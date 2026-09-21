/**
 * PetGenService（应用层）——宠物 IP 自定义生成的用户面用例
 *
 * 提交/重启（配额拦截 + 状态机入口校验）、查询、概念图确认、素材读取。
 * 状态机的推进由 PetGenProcessor tick 负责（独立模块），本服务只管
 * 用户面入口的状态转移门槛。存储在 infra/petgen-repo，配额策略在
 * petgen/quota，Pro/BYOK 专属判定在此层（账号层字段）。
 */

import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import { join } from 'path';
import {
  DEFAULT_PET_PRESET,
  type PetPresetId,
} from '@cyber-stray/shared/pet';
import type { ControlPlaneConfig } from '../config.js';
import type { ControlDb } from '../db/client.js';
import { getDb } from '../db/client.js';
import type { PetGenTask } from '../db/schema.js';
import * as petgenRepo from '../infra/petgen-repo.js';
import { readTenantAsset } from '../infra/tenant-data-reader.js';
import { findTenantPlan } from '../infra/tenant-access.js';
import { nextMonthStart, petGenQuota } from '../petgen/quota.js';
import type { PetSpec, PetGenTaskStatus } from '../petgen/types.js';
import { tenantDataDir } from '../tenant.js';

export interface PetGenServiceDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'petGenMonthlyQuota'>;
}

export type PetGenOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; status: 403 | 404 | 409 | 429; error: string; data?: unknown };

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
  async function getQuota(tenantId: string) {
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

  return {
    submitTask,
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
