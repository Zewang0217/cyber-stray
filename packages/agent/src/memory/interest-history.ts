/**
 * 兴趣历史追踪（Interest History）
 *
 * Phase 6 (OBS-01)：记录兴趣图谱权重快照，支撑 Web 面板时间序列展示与坍缩检测。
 *
 * JSONL 存储：每行一个快照 { timestamp, hash, nodes[], entropy, nodeCount }
 * 自动去重：连续相同 hash 的快照不重复记录。
 *
 * 最佳努力（best-effort）：记录失败不抛错，不阻断 InterestGraph.persist()。
 */

import { appendFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { consola } from '../logger.js';
import { getDataPath } from '../config.js';

const logger = consola.withTag('InterestHistory');

// ============================================
// Types
// ============================================

/** 快照中的单个兴趣节点 */
export interface InterestSnapshotNode {
  id: string;
  weight: number;
  effectiveWeight: number;
  source: string;
  reinforceCount: number;
}

/** 一次兴趣图谱快照 */
export interface InterestSnapshot {
  timestamp: string;
  hash: string;
  nodes: InterestSnapshotNode[];
  entropy: number;
  nodeCount: number;
}

/** recordInterestSnapshot 的入参 — 不含 hash（由函数内部计算） */
export type InterestSnapshotInput = Omit<InterestSnapshot, 'hash'>;

// ============================================
// 文件路径
// ============================================

function getHistoryPath(): string {
  return getDataPath('interest-history.jsonl');
}

// ============================================
// 简单哈希（用于去重）
// ============================================

/**
 * 计算快照内容的简单哈希（用于去重）。
 * 与加密无关——仅用于判断两次快照是否相同。
 */
function computeHash(input: InterestSnapshotInput): string {
  // 用节点权重拼接作为指纹
  const fingerprint = input.nodes
    .map((n) => `${n.id}:${n.weight.toFixed(4)}:${n.source}`)
    .sort()
    .join('|');

  // 简单 DJB2 哈希。DJB2 输出 ≤ 32-bit，hex 最多 8 位，padStart 补齐即可
  let hash = 5381;
  for (let i = 0; i < fingerprint.length; i++) {
    hash = ((hash << 5) + hash + fingerprint.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ============================================
// 公开 API
// ============================================

/**
 * 记录一次兴趣图谱快照。
 *
 * 自动去重：与上一行 hash 相同时跳过。
 * 最佳努力：写入失败仅 warn，不抛错。
 */
export async function recordInterestSnapshot(input: InterestSnapshotInput): Promise<void> {
  const hash = computeHash(input);

  try {
    // 去重检查：读最后一行
    const lastHash = await readLastHash();
    if (lastHash === hash) {
      logger.debug('兴趣快照未变化，跳过记录', { hash });
      return;
    }
  } catch (err) {
    // 读取失败不阻止记录（文件尚不存在为预期场景）
    logger.debug('读取上次 hash 失败，跳过去重', { err });
  }

  const snapshot: InterestSnapshot = {
    timestamp: input.timestamp,
    hash,
    nodes: input.nodes,
    entropy: input.entropy,
    nodeCount: input.nodeCount,
  };

  const historyPath = getHistoryPath();

  try {
    await mkdir('data', { recursive: true });
    const line = JSON.stringify(snapshot) + '\n';
    await appendFile(historyPath, line, 'utf-8');
    logger.debug('兴趣快照已记录', {
      hash,
      nodeCount: input.nodeCount,
      entropy: input.entropy.toFixed(3),
    });
  } catch (error) {
    logger.warn('记录兴趣快照失败', { error, hash });
  }
}

/**
 * 读取兴趣历史时间序列。
 *
 * @param limit - 返回最近 N 条（默认 50）
 * @param since - 只返回此时间之后的快照（ISO 字符串）
 * @returns 按时间升序的快照数组
 */
export async function getInterestHistory(
  limit = 50,
  since?: string,
): Promise<InterestSnapshot[]> {
  const historyPath = getHistoryPath();

  if (!existsSync(historyPath)) {
    return [];
  }

  try {
    const content = await readFile(historyPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const snapshots: InterestSnapshot[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as InterestSnapshot;
        // 基本校验
        if (
          typeof parsed.timestamp === 'string' &&
          Array.isArray(parsed.nodes) &&
          typeof parsed.entropy === 'number'
        ) {
          snapshots.push(parsed);
        }
      } catch {
        // 跳过非法行
      }
    }

    // 按时间过滤
    let filtered = snapshots;
    if (since) {
      filtered = snapshots.filter((s) => s.timestamp >= since);
    }

    // 取最近 N 条
    return filtered.slice(-limit);
  } catch (error) {
    logger.warn('读取兴趣历史失败', { error });
    return [];
  }
}

// ============================================
// 内部辅助
// ============================================

/** 读取最后一行的 hash（用于去重） */
async function readLastHash(): Promise<string | null> {
  const historyPath = getHistoryPath();

  if (!existsSync(historyPath)) {
    return null;
  }

  const content = await readFile(historyPath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);
  if (lines.length === 0) return null;

  const lastLine = lines[lines.length - 1];
  if (!lastLine) return null;

  try {
    const parsed = JSON.parse(lastLine) as { hash?: string };
    return typeof parsed.hash === 'string' ? parsed.hash : null;
  } catch {
    return null;
  }
}
