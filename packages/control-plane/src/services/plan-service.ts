/**
 * PlanService（应用层）——套餐门控的用户面用例
 *
 * 查套餐/限额/推送窗/BYOK 状态、切换套餐（降级清窗口：自定义推送时间是
 * Pro 权益，BYOK 同 Pro 保留）、推送窗设置、BYOK key 绑定（信封加密，
 * 对所有套餐开放——自带 key 降平台成本，绑 key 不变更套餐）。
 * 套餐变更的 admin-only 判定在接口层（RBAC 复用 adminSession）。
 */

import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import type { PlanValue } from '../plan/limits.js';
import { planLimits } from '../plan/limits.js';
import * as petsRepo from '../infra/pets-repo.js';
import { findTenantById, findTenantPlan, updateTenantPlan } from '../infra/tenant-access.js';
import { openTenantSecrets } from '../secrets/tenant-secrets.js';

/** BYOK DeepSeek key 的信封加密存储名（worker-runner SECRET_FIELD_BY_NAME 同名约定） */
export const BYOK_KEY_SECRET = 'deepseek_api_key';

export interface PlanServiceDeps {
  config: Pick<ControlPlaneConfig, 'dataDir'>;
}

export type PlanOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; status: 403 | 409; error: string };

export function createPlanService({ config }: PlanServiceDeps) {
  /** 套餐 + 限额 + 推送窗 + BYOK 状态（不回显 key） */
  async function getPlan(tenantId: string): Promise<PlanOutcome<unknown>> {
    const pet = await petsRepo.findPetByTenant(await getDb(), tenantId);
    if (!pet) return { ok: false, status: 409, error: '尚未领养宠物' };

    const plan = (await findTenantPlan(config.dataDir, tenantId)) ?? 'free';
    const store = await openTenantSecrets(config.dataDir, tenantId);
    const names = await store.list();
    return {
      ok: true,
      data: {
        plan,
        limits: planLimits(plan),
        pushWindow:
          pet.pushWindowStart !== null && pet.pushWindowEnd !== null
            ? { startHour: pet.pushWindowStart, endHour: pet.pushWindowEnd }
            : null,
        byok: { keyBound: names.includes(BYOK_KEY_SECRET) },
      },
    };
  }

  /** 切换套餐；降级清窗口（自定义推送时间是 Pro 权益，BYOK 同 Pro 保留） */
  async function changePlan(tenantId: string, nextPlan: PlanValue): Promise<PlanOutcome<{ plan: string }>> {
    const db = await getDb();
    const pet = await petsRepo.findPetByTenant(db, tenantId);
    if (!pet) return { ok: false, status: 409, error: '尚未领养宠物' };

    await updateTenantPlan(config.dataDir, tenantId, nextPlan);
    if (nextPlan === 'free') {
      await petsRepo.clearPushWindow(db, tenantId);
    }
    return { ok: true, data: { plan: nextPlan } };
  }

  /** Pro/BYOK 自定义推送时间窗（本地小时；free 403） */
  async function setPushWindow(
    tenantId: string,
    startHour: number,
    endHour: number,
  ): Promise<PlanOutcome<{ startHour: number; endHour: number }>> {
    const db = await getDb();
    const pet = await petsRepo.findPetByTenant(db, tenantId);
    if (!pet) return { ok: false, status: 409, error: '尚未领养宠物' };
    const plan = (await findTenantPlan(config.dataDir, tenantId)) ?? 'free';
    if (plan === 'free') {
      return { ok: false, status: 403, error: '自定义推送时间是 Pro 权益' };
    }

    await petsRepo.updatePushWindow(db, tenantId, startHour, endHour);
    return { ok: true, data: { startHour, endHour } };
  }

  /** 清推送窗（回全天） */
  async function clearPushWindow(tenantId: string): Promise<PlanOutcome<{ cleared: boolean }>> {
    const db = await getDb();
    const pet = await petsRepo.findPetByTenant(db, tenantId);
    if (!pet) return { ok: false, status: 409, error: '尚未领养宠物' };
    await petsRepo.clearPushWindow(db, tenantId);
    return { ok: true, data: { cleared: true } };
  }

  /** BYOK 自带 DeepSeek key（信封加密存储） */
  async function bindByokKey(tenantId: string, apiKey: string): Promise<PlanOutcome<{ bound: boolean }>> {
    const pet = await petsRepo.findPetByTenant(await getDb(), tenantId);
    if (!pet) return { ok: false, status: 409, error: '尚未领养宠物' };

    const store = await openTenantSecrets(config.dataDir, tenantId);
    await store.set(BYOK_KEY_SECRET, apiKey);
    return { ok: true, data: { bound: true } };
  }

  async function unbindByokKey(tenantId: string) {
    const store = await openTenantSecrets(config.dataDir, tenantId);
    const removed = await store.delete(BYOK_KEY_SECRET);
    return { removed };
  }

  return { getPlan, changePlan, setPushWindow, clearPushWindow, bindByokKey, unbindByokKey };
}

export type PlanService = ReturnType<typeof createPlanService>;
