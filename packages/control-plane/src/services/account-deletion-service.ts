/**
 * AccountDeletionService（应用层）——账户注销用例编排
 *
 * 语义：软删（tenants 行保留作审计：方式/理由/操作者/时刻），生效点三处——
 * requireTenant 拒绝一切 API 访问、调度器经 pets.status='paused' 停止派发、
 * 登录回调不再签发 session（同 sub 无法重注册刷配额；恢复需管理员手工清字段）。
 * 租户文件目录暂不处置——内测期数据保留期是未拍板决策，见
 * docs/research/admin-entry-account-deletion-quota-2026-10.md 决策点 1。
 */

import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { isAdminSub } from '../infra/admin-repo.js';
import * as petsRepo from '../infra/pets-repo.js';
import { findTenantById, markTenantDeleted } from '../infra/tenant-access.js';

export interface AccountDeletionDeps {
  config: Pick<ControlPlaneConfig, 'dataDir' | 'adminSubs'>;
}

export type DeletionOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; status: 400 | 404; error: string };

/** 批量注销的单项结果（逐项独立成败，见 batchDelete） */
export type BatchDeletionItem =
  | { tenantId: string; ok: true }
  | { tenantId: string; ok: false; error: string };

/** 自助注销的确认口径：有宠物 = 输宠物名；未领养 = 输「注销」二字 */
export function expectedSelfConfirm(petName: string | null): string {
  return petName ?? '注销';
}

export function createAccountDeletionService({ config }: AccountDeletionDeps) {
  async function deleteAccount(input: {
    tenantId: string;
    mode: 'self' | 'admin';
    reason: string | null;
    operatorSub: string;
  }): Promise<DeletionOutcome<{ tenantId: string; deletedAt: number }>> {
    const tenant = await findTenantById(config.dataDir, input.tenantId);
    if (!tenant) return { ok: false, status: 404, error: '用户不存在' };
    if (tenant.deletedAt !== null) return { ok: false, status: 400, error: '该账号已注销' };
    // 管理员账号不可注销（admins 表 ∪ env 白名单）：防误删运维身份、锁死管理面；
    // 确要注销先撤销其管理员身份（与「撤销管理员」的禁自撤 + 末位保护同向）
    if (await isAdminSub(config.dataDir, input.tenantId, config.adminSubs)) {
      return { ok: false, status: 400, error: '管理员账号不可注销，请先撤销其管理员身份' };
    }
    const deletedAt = await markTenantDeleted(config.dataDir, input.tenantId, {
      mode: input.mode,
      reason: input.reason,
      operatorSub: input.operatorSub,
    });
    // null 只可能是并发下已被注销（上面刚查过未注销），不静默吞
    if (deletedAt === null) return { ok: false, status: 400, error: '该账号已注销' };
    return { ok: true, data: { tenantId: input.tenantId, deletedAt } };
  }

  /** 自助注销：输入宠物名（未领养 = 「注销」二字）确认，防误触 */
  async function deleteSelf(input: {
    tenantId: string;
    sub: string;
    confirmPetName: string;
    reason?: string;
  }): Promise<DeletionOutcome<{ tenantId: string }>> {
    const db = await getDb(config.dataDir);
    const pet = await petsRepo.findPetByTenant(db, input.tenantId);
    if (input.confirmPetName !== expectedSelfConfirm(pet?.name ?? null)) {
      return {
        ok: false,
        status: 400,
        error: pet ? '宠物名不匹配，请输入当前宠物名确认' : '尚未领养宠物：输入「注销」二字确认',
      };
    }
    const reason = input.reason?.trim();
    const outcome = await deleteAccount({
      tenantId: input.tenantId,
      mode: 'self',
      reason: reason ? reason : null,
      operatorSub: input.sub,
    });
    return outcome.ok ? { ok: true, data: { tenantId: outcome.data.tenantId } } : outcome;
  }

  /**
   * 批量注销：逐项独立成败（文件/DB 不共享事务，全有全无是假语义），
   * 返回明细供管理面板逐行展示；调用方保证 reason 非空（路由校验）。
   */
  async function batchDelete(input: {
    tenantIds: string[];
    reason: string;
    operatorSub: string;
  }): Promise<BatchDeletionItem[]> {
    const results: BatchDeletionItem[] = [];
    for (const tenantId of input.tenantIds) {
      const outcome = await deleteAccount({
        tenantId,
        mode: 'admin',
        reason: input.reason,
        operatorSub: input.operatorSub,
      });
      results.push(
        outcome.ok
          ? { tenantId, ok: true }
          : { tenantId, ok: false, error: outcome.error },
      );
    }
    return results;
  }

  return { deleteAccount, deleteSelf, batchDelete };
}

export type AccountDeletionService = ReturnType<typeof createAccountDeletionService>;
