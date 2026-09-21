import { createHash } from 'crypto';
import type { InterestGraphData, InterestSource } from '@cyber-stray/shared/interest-graph';

/**
 * 进化快照的纯规则（领域层）
 *
 * 快照形状、内容摘要 hash、回滚还原图的构造。I/O 在 infra/evolution-store。
 */

const INTEREST_SOURCES: readonly InterestSource[] = ['default', 'reflection', 'feedback', 'migration'];

/** 快照生成确定性 hash：内容摘要，用于引用/回滚定位（16 位 = sha256 截断）。
 * 注：agent 侧快照 hash 为 8 位 hex（DJB2），两者都允许作为回滚定位符 */
export function hashSnapshot(timestamp: string, nodes: Array<Record<string, unknown>>): string {
  return createHash('sha256').update(timestamp + JSON.stringify(nodes)).digest('hex').slice(0, 16);
}

export interface EvolutionSnapshot {
  timestamp: string;
  hash: string;
  entropy: number;
  nodes: Array<Record<string, unknown>>;
  source?: string;
}

/**
 * 由快照节点构造还原后的兴趣图谱（回滚落盘用）。形状 = agent
 * InterestGraphData（shared 单一真相源）；字段逐一做类型收敛，
 * 坏字段回退安全默认值。
 */
export function buildRestoredGraph(nodes: Array<Record<string, unknown>>): InterestGraphData {
  const now = new Date().toISOString();
  return {
    version: 2,
    lastUpdated: now,
    nodes: nodes.map((n) => ({
      id: String(n.id),
      weight: typeof n.weight === 'number' ? n.weight : 0,
      source: (INTEREST_SOURCES as readonly string[]).includes(String(n.source))
        ? (String(n.source) as InterestSource)
        : 'default',
      createdAt: typeof n.createdAt === 'string' ? n.createdAt : now,
      lastReinforced: typeof n.lastReinforced === 'string' ? n.lastReinforced : now,
      reinforceCount: typeof n.reinforceCount === 'number' ? n.reinforceCount : 0,
      path: String(n.id),
    })),
  };
}
