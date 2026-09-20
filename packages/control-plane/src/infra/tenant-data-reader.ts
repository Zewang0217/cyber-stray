/**
 * agent 租户数据文件的只读访问（基础设施层）
 *
 * web 只读契约的读边界：CP 只读 agent 写下的文件，绝不写；字段解析规则
 * 只在 agent 侧，本模块只做文件读取与形状校验。ENOENT 一律按合法空态
 * 处理（租户尚未游荡/未产生数据）；损坏或形状非法显式抛（禁兜底）。
 */

import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { parseHistoryJsonl } from '../domain/history-view.js';
import { tenantDataDir } from '../tenant.js';

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * state.json 合成游荡历史（读边界）：state.json 本无 wanderHistory 字段，
 * 真实记录在 wander-history.json（尾部最新）——注入最近 20 条，前端不再
 * 恒空态。无 state.json → null；损坏/形状非法抛错（消息带文件名，防日志归因误导）。
 */
export async function readTenantStateSnapshot(
  dataDir: string,
  tenantId: string,
): Promise<Record<string, unknown> | null> {
  const dir = tenantDataDir(dataDir, tenantId);
  let state: Record<string, unknown>;
  try {
    state = JSON.parse(await readFile(join(dir, 'state.json'), 'utf-8')) as Record<string, unknown>;
  } catch (error) {
    if (isEnoent(error)) return null;
    throw error;
  }

  let raw: string;
  try {
    raw = await readFile(join(dir, 'wander-history.json'), 'utf-8');
  } catch (error) {
    if (isEnoent(error)) return state;
    throw error;
  }
  let history: unknown;
  try {
    history = JSON.parse(raw);
  } catch {
    throw new Error('wander-history.json 不是合法 JSON');
  }
  if (!Array.isArray(history)) {
    throw new Error('wander-history.json 形状非法（须为数组）');
  }
  state.wanderHistory = history.slice(-20);
  return state;
}

/** 兴趣图谱（存储原始权重）；文件不存在 → 空图谱（空态） */
export async function readTenantInterestGraph(
  dataDir: string,
  tenantId: string,
): Promise<{ nodes: Array<{ weight: number }>; lastUpdated: string | null }> {
  try {
    const data = JSON.parse(
      await readFile(join(tenantDataDir(dataDir, tenantId), 'user-profile', 'user-interests.json'), 'utf-8'),
    ) as { nodes?: Array<{ weight: number }>; lastUpdated?: string };
    return { nodes: data.nodes ?? [], lastUpdated: data.lastUpdated ?? null };
  } catch (error) {
    if (isEnoent(error)) return { nodes: [], lastUpdated: null };
    throw error;
  }
}

/** 兴趣权重时间序列快照（形状合法的行）；文件不存在 → [] */
export async function readInterestHistorySnapshots(dataDir: string, tenantId: string): Promise<unknown[]> {
  try {
    const content = await readFile(
      join(tenantDataDir(dataDir, tenantId), 'interest-history.jsonl'),
      'utf-8',
    );
    const snapshots: unknown[] = [];
    for (const line of content.trim().split('\n').filter(Boolean)) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
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
    return snapshots;
  } catch (error) {
    if (isEnoent(error)) return [];
    throw error;
  }
}

/** 历史推送记录（全量、归一化后）；目录不存在 → []。目录/文件级错误带上下文记日志后抛出 */
export async function readPushHistoryItems(
  dataDir: string,
  tenantId: string,
): Promise<Array<Record<string, unknown>>> {
  const historyDir = join(tenantDataDir(dataDir, tenantId), 'history');
  let files: string[];
  try {
    // 只扫 .jsonl（同目录可能有 pushed.json 等非历史文件）
    files = (await readdir(historyDir)).filter((f) => f.endsWith('.jsonl'));
  } catch (error) {
    if (isEnoent(error)) return [];
    console.error('[data] history 目录读取失败：', error);
    throw new Error('历史目录不可读');
  }

  const items: Array<Record<string, unknown>> = [];
  // 全量遍历（分页契约要求 total/hasMore 基于全部记录；speaks 每天数行，解析开销毫秒级）
  for (const file of files) {
    let content: string;
    try {
      content = await readFile(join(historyDir, file), 'utf-8');
    } catch (error) {
      // 仅 ENOENT（readdir 后被并发清理）合法跳过；其余显式抛（禁兜底）
      if (isEnoent(error)) continue;
      console.error('[data] history 文件读取失败：', error);
      throw new Error('历史记录不可读');
    }
    items.push(...parseHistoryJsonl(content));
  }
  return items;
}

/** 读租户 state.json 的游荡/推送统计（缺失 = 0；损坏 = 显式抛，不吞） */
export async function readTenantWanderStats(
  dataDir: string,
  tenantId: string,
): Promise<{ totalWanders: number; totalPushes: number }> {
  try {
    const parsed = JSON.parse(
      await readFile(join(tenantDataDir(dataDir, tenantId), 'state.json'), 'utf-8'),
    ) as { totalWanders?: unknown; totalPushes?: unknown };
    return {
      totalWanders: typeof parsed.totalWanders === 'number' ? parsed.totalWanders : 0,
      totalPushes: typeof parsed.totalPushes === 'number' ? parsed.totalPushes : 0,
    };
  } catch (error) {
    if (isEnoent(error)) {
      return { totalWanders: 0, totalPushes: 0 };
    }
    throw error;
  }
}
