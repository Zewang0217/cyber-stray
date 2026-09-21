/**
 * EvolutionService（应用层）——进化可视化与回滚
 *
 * 快照序列 + 反馈事件 + 游荡摘要的聚合读取；回滚 = 还原兴趣图谱
 * （shared 单一真相源形状）+ 追加 source=rollback 快照（可追溯可撤销）。
 * 文件 I/O 在 infra/evolution-store，纯规则在 domain/evolution。
 */

import type { ControlPlaneConfig } from '../config.js';
import { buildRestoredGraph, hashSnapshot, type EvolutionSnapshot } from '../domain/evolution.js';
import {
  appendEvolutionSnapshot,
  readEvolutionSnapshots,
  readFeedbackEvents,
  restoreInterestsGraph,
} from '../infra/evolution-store.js';
import * as petsRepo from '../infra/pets-repo.js';
import { readTenantWanderStats } from '../infra/tenant-data-reader.js';
import { tenantDataDir } from '../tenant.js';

export interface EvolutionServiceDeps {
  config: Pick<ControlPlaneConfig, 'dataDir'>;
}

export type EvolutionOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; status: 404; error: string };

export function createEvolutionService({ config }: EvolutionServiceDeps) {
  /** 快照序列 + 反馈事件 + 游荡摘要 */
  async function getEvolution(tenantId: string) {
    const dir = tenantDataDir(config.dataDir, tenantId);
    const snapshots = await readEvolutionSnapshots(dir);
    const feedbacks = await readFeedbackEvents(dir);
    const summary = await readTenantWanderStats(config.dataDir, tenantId);
    return { snapshots, feedbacks, summary };
  }

  /** 回滚到指定快照；本租户历史无此 hash（含他租户）→ 404 不暴露存在性 */
  async function rollback(
    tenantId: string,
    hash: string,
  ): Promise<EvolutionOutcome<{ tenantId: string; rolledBackTo: string; snapshot: EvolutionSnapshot }>> {
    const dir = tenantDataDir(config.dataDir, tenantId);

    const snapshots = await readEvolutionSnapshots(dir);
    const target = snapshots.find((s) => s.hash === hash);
    if (!target) {
      return { ok: false, status: 404, error: '快照不存在' };
    }

    // 还原 user-interests.json（agent 图谱 schema；形状来自 shared）
    await restoreInterestsGraph(dir, buildRestoredGraph(target.nodes));

    // 追加回滚快照（可追溯：source=rollback，指向被回滚到的 hash）
    const now = new Date().toISOString();
    const rollbackSnapshot: EvolutionSnapshot = {
      timestamp: now,
      hash: hashSnapshot(now, target.nodes),
      entropy: target.entropy,
      source: 'rollback',
      nodes: target.nodes,
    };
    await appendEvolutionSnapshot(dir, rollbackSnapshot);

    return { ok: true, data: { tenantId, rolledBackTo: hash, snapshot: rollbackSnapshot } };
  }

  return { getEvolution, rollback };
}

export type EvolutionService = ReturnType<typeof createEvolutionService>;
