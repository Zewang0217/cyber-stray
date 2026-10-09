/**
 * AdminService（应用层）——运营管理面板的用例编排
 *
 * 职责：用户列表（租户 + 宠物摘要 + 游荡统计）、套餐与宠物状态管理、
 * 管理员授予/撤销（末位管理员保护）、用量成本报表、全局模型配置。
 * RBAC 判定（session → admins 表 ∪ env 白名单）在接口层；存储在 infra，
 * 聚合计算在 domain/usage-agg。
 */

import {
  MODEL_CANDIDATES,
  getModelConfig,
  setModelConfig,
  type ModelConfig,
} from '../infra/app-config.js';
import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import type { PlanValue } from '../plan/limits.js';
import { localDateKey, readTenantUsage } from '../infra/usage.js';
import { aggregateTenantUsage } from '../domain/usage-agg.js';
import * as adminRepo from '../infra/admin-repo.js';
import * as invitesRepo from '../infra/invites-repo.js';
import type { InvitePublic } from '../infra/invites-repo.js';
import * as petsRepo from '../infra/pets-repo.js';
import {
  findTenantById,
  listTenants,
  updateTenantPlan,
  updateTenantQuotaOverrides,
} from '../infra/tenant-access.js';
import { parseTenantQuotaOverrides, type TenantQuotaOverrides } from '@cyber-stray/shared/quota';
import { readTenantWanderStats } from '../infra/tenant-data-reader.js';
import { costOf, requireModelPrice } from '../domain/pricing.js';
import { resolveEntitlements } from '../plan/entitlements.js';
import type { EffectiveEntitlements } from '@cyber-stray/shared/plan';
import { planBudgetYuan } from '../scheduler/budget.js';

export interface AdminServiceDeps {
  config: Pick<
    ControlPlaneConfig,
    'dataDir' | 'productMode' | 'adminSubs' | 'arkImageModel' | 'visionModel' | 'llmBudgetEnabled' | 'llmBudgetYuan' | 'webOrigin'
  >;
}

/** 用量报表的租户行（ledgerError 非空 = 该租户账本故障，数值不计入汇总） */
export interface TenantUsageRow extends EffectiveEntitlements {
  tenantId: string;
  tenantName: string;
  llmCostToday: number;
  llmBudgetYuan: number | null;
  ledgerError: string | null;
  llmTokens: number;
  imageCount: number;
  visionCount: number;
  cost: number;
  lastActive: string | null;
}

export type AdminOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; status: 400 | 404; error: string };

export function createAdminService({ config }: AdminServiceDeps) {
  /** 邀请列表（#301；脱敏 tokenHash） */
  async function listInvites() {
    return invitesRepo.listInvites(config.dataDir);
  }

  /** 生成邀请：raw token / 完整链接只在本次响应出现一次 */
  async function createInvite(input: { createdBy: string; label?: string; maxUses?: number }) {
    const invite = await invitesRepo.createInvite(config.dataDir, input);
    return { ...invite, link: `${config.webOrigin}/?invite=${invite.token}` };
  }

  /** 为原链接追加可邀请人数，不恢复吊销链接。 */
  async function expandInvite(id: string, additionalUses: number): Promise<AdminOutcome<InvitePublic>> {
    const row = await invitesRepo.expandInvite(config.dataDir, id, additionalUses);
    return row ? { ok: true, data: row } : { ok: false, status: 400, error: '邀请不存在、已吊销或增加后超过人数上限' };
  }

  /** 吊销邀请（已吊销 → 404） */
  async function revokeInvite(id: string): Promise<AdminOutcome<InvitePublic>> {
    const ok = await invitesRepo.revokeInvite(config.dataDir, id);
    if (!ok) return { ok: false, status: 404, error: '邀请不存在或状态不可吊销' };
    const all = await invitesRepo.listInvites(config.dataDir);
    const row = all.find((r) => r.id === id);
    if (!row) return { ok: false, status: 404, error: '邀请不存在' };
    return { ok: true, data: row };
  }

  /** 全部用户（tenants 主表，含无宠物）+ 宠物摘要 + 游荡统计 */
  async function listUsers() {
    const tenantRows = await listTenants(config.dataDir);
    const petRows = await petsRepo.listAllPets(await getDb(config.dataDir));
    const rows = await Promise.all(
      tenantRows.map(async (t) => {
        const pet = petRows.find((p) => p.tenantId === t.id) ?? null;
        const stats = pet
          ? await readTenantWanderStats(config.dataDir, t.id)
          : { totalWanders: 0, totalPushes: 0 };
        return {
          tenantId: t.id,
          tenantName: t.name,
          ...resolveEntitlements(t.plan, config.productMode),
          createdAt: t.createdAt,
          deletedAt: t.deletedAt,
          deletionMode: t.deletionMode,
          deletionReason: t.deletionReason,
          quotaOverrides: parseTenantQuotaOverrides(t.quotaOverrides),
          petId: pet?.id ?? null,
          petName: pet?.name ?? null,
          petStatus: pet?.status ?? null,
          petBoredom: pet?.boredom ?? null,
          petEnergy: pet?.energy ?? null,
          petLastRunAt: pet?.lastRunAt ?? null,
          totalWanders: stats.totalWanders,
          totalPushes: stats.totalPushes,
        };
      }),
    );
    return rows;
  }

  async function updatePlan(tenantId: string, plan: PlanValue): Promise<AdminOutcome<{ tenantId: string; plan: string }>> {
    if (config.productMode !== 'paid') {
      return { ok: false, status: 400, error: '邀请内测统一享有 Pro 权益，套餐变更未开放' };
    }
    const tenant = await findTenantById(config.dataDir, tenantId);
    if (!tenant) return { ok: false, status: 404, error: '用户不存在' };
    await updateTenantPlan(config.dataDir, tenantId, plan);
    return { ok: true, data: { tenantId, plan } };
  }

  async function setPetStatus(
    tenantId: string,
    status: 'active' | 'paused',
  ): Promise<AdminOutcome<{ tenantId: string; status: string }>> {
    const db = await getDb(config.dataDir);
    const dbPet = await petsRepo.findPetByTenant(db, tenantId);
    if (!dbPet) return { ok: false, status: 404, error: '该用户无宠物' };
    await petsRepo.updatePetStatus(db, tenantId, status);
    return { ok: true, data: { tenantId, status } };
  }

  /** 租户配额覆盖（运维调额）：入参已过 shared/quota 守卫；null = 清空回套餐默认 */
  async function setQuotaOverrides(
    tenantId: string,
    overrides: TenantQuotaOverrides | null,
  ): Promise<AdminOutcome<{ tenantId: string; quotaOverrides: TenantQuotaOverrides | null }>> {
    const tenant = await findTenantById(config.dataDir, tenantId);
    if (!tenant) return { ok: false, status: 404, error: '用户不存在' };
    await updateTenantQuotaOverrides(
      config.dataDir,
      tenantId,
      overrides ? JSON.stringify(overrides) : null,
    );
    return { ok: true, data: { tenantId, quotaOverrides: overrides } };
  }

  /** 管理员列表（env bootstrap 的也展示，来源标注 env） */
  async function listAdmins() {
    const rows = await adminRepo.listAdmins(config.dataDir);
    const list = rows.map((r) => ({ sub: r.sub, grantedBy: r.grantedBy, createdAt: r.createdAt }));
    for (const sub of config.adminSubs) {
      if (!list.some((a) => a.sub === sub)) list.push({ sub, grantedBy: 'env', createdAt: 0 });
    }
    return list;
  }

  async function grantAdmin(sub: string, grantedBy: string) {
    await adminRepo.insertAdmin(config.dataDir, sub, grantedBy);
    return { sub, grantedBy };
  }

  /** 撤销管理员：禁自撤 + 末位保护（表内将空且 env 白名单空 → 管理面不可锁死） */
  async function revokeAdmin(sub: string, operatorSub: string): Promise<AdminOutcome<{ removed: boolean }>> {
    if (sub === operatorSub) {
      return { ok: false, status: 400, error: '不能撤销自己（会锁死管理面）' };
    }
    const remaining = await adminRepo.listAdmins(config.dataDir);
    const isLast = remaining.length <= 1;
    if (isLast && config.adminSubs.length === 0) {
      return { ok: false, status: 400, error: '至少保留一名管理员' };
    }
    const removed = await adminRepo.deleteAdminBySub(config.dataDir, sub);
    return { ok: true, data: { removed: removed.rowsAffected > 0 } };
  }

  /** 每套餐今日 LLM 预算水位（0 = 该套餐不限；未启用 → null） */
  function budgetYuanFor(plan: string): number | null {
    return planBudgetYuan({ enabled: config.llmBudgetEnabled, yuanPerPlan: config.llmBudgetYuan },
      resolveEntitlements(plan, config.productMode).plan);
  }

  /**
   * 用量成本报表：summary 总览 + perTenant（含今日 LLM 水位）+ recent 最近 50 条明细。
   * 单租户账本故障（记账闩锁/脏行/未知模型单价）不炸全表：该租户行显式标记
   * ledgerError、汇总只计健康租户——闩锁本就是等运维处理的信号，观测面必须能
   * 看见它而不是整页 500（修复前任一租户故障即 GET /usage 500）。
   */
  async function usageReport(from?: string, to?: string) {
    const today = localDateKey();
    const tenantRows = await listTenants(config.dataDir);
    const perTenant: TenantUsageRow[] = await Promise.all(
      tenantRows.map(async (t): Promise<TenantUsageRow> => {
        const base: Omit<TenantUsageRow, 'llmCostToday' | 'llmTokens' | 'imageCount' | 'visionCount' | 'cost' | 'lastActive'> = {
          tenantId: t.id,
          tenantName: t.name,
          ...resolveEntitlements(t.plan, config.productMode),
          llmBudgetYuan: budgetYuanFor(t.plan),
          ledgerError: null,
        };
        try {
          const rows = await readTenantUsage(config.dataDir, t.id, from, to);
          const agg = aggregateTenantUsage(rows);
          const todayRows = await readTenantUsage(config.dataDir, t.id, today, today);
          const llmCostToday = todayRows.reduce((s, row) => (row.kind === 'llm' ? s + costOf(row) : s), 0);
          return { ...base, llmCostToday, ...agg };
        } catch (error) {
          return {
            ...base,
            llmCostToday: 0,
            ledgerError: error instanceof Error ? error.message : String(error),
            llmTokens: 0,
            imageCount: 0,
            visionCount: 0,
            cost: 0,
            lastActive: null,
          };
        }
      }),
    );

    const healthy = perTenant.filter((p) => p.ledgerError === null);
    const allRows = (await Promise.all(
      healthy.map((t) => readTenantUsage(config.dataDir, t.tenantId, from, to)),
    )).flat();
    const summary = {
      totalCost: healthy.reduce((s, p) => s + p.cost, 0),
      totalLlmTokens: healthy.reduce((s, p) => s + p.llmTokens, 0),
      totalImages: healthy.reduce((s, p) => s + p.imageCount, 0),
      totalVisionQc: healthy.reduce((s, p) => s + p.visionCount, 0),
      /** 账本故障租户数（面板据此提示运维；汇总未计入这些租户） */
      ledgerErrors: perTenant.length - healthy.length,
    };
    const recent = allRows
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      .slice(0, 50)
      .map((row) => ({ ...row, cost: costOf(row) }));

    return { summary, perTenant, recent };
  }

  /** 全局模型配置：当前生效值 + 候选下拉（未 refresh 时回退 env 默认） */
  function getModelSettings() {
    const cfg = getModelConfig({
      imageModel: config.arkImageModel,
      visionModel: config.visionModel,
    });
    return { imageModel: cfg.imageModel, visionModel: cfg.visionModel, candidates: MODEL_CANDIDATES };
  }

  /** 更新全局模型（缺省字段保持不变）：写 DB + 刷缓存，下次生图生效 */
  async function updateModelSettings(next: { imageModel?: string; visionModel?: string }): Promise<AdminOutcome<ModelConfig>> {
    const current = getModelConfig({
      imageModel: config.arkImageModel,
      visionModel: config.visionModel,
    });
    const merged: ModelConfig = {
      imageModel: next.imageModel ?? current.imageModel,
      visionModel: next.visionModel ?? current.visionModel,
    };
    try {
      requireModelPrice(merged.imageModel, 'image');
      requireModelPrice(merged.visionModel, 'vision_qc');
    } catch (error) {
      return { ok: false, status: 400, error: error instanceof Error ? error.message : String(error) };
    }
    const saved = await setModelConfig(config.dataDir, merged);
    return { ok: true, data: { imageModel: saved.imageModel, visionModel: saved.visionModel } };
  }

  return {
    listUsers,
    updatePlan,
    setPetStatus,
    setQuotaOverrides,
    listAdmins,
    grantAdmin,
    revokeAdmin,
    usageReport,
    getModelSettings,
    updateModelSettings,
    listInvites,
    createInvite,
    revokeInvite,
    expandInvite,
  };
}

export type AdminService = ReturnType<typeof createAdminService>;
