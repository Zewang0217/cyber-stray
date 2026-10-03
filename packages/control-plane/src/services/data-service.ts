/**
 * DataService（应用层）——Web 租户只读数据面的用例编排
 *
 * 职责：agent 状态（pets 表数值合成读边界）、兴趣图谱（熵计算走 shared
 * 单一真相源）、兴趣历史与推送历史（分页契约）。文件只读访问在
 * infra/tenant-data-reader，展示归一化纯函数在 domain/history-view。
 * 损坏数据显式 500（禁兜底成空态掩盖损坏）。
 */

import { shannonEntropy } from '@cyber-stray/shared/interest-graph';
import type { SpeakHistoryItem } from '@cyber-stray/shared/push';
import type { ControlPlaneConfig } from '../config.js';
import { getDb } from '../db/client.js';
import * as petsRepo from '../infra/pets-repo.js';
import {
  readDiaryEntry,
  readDiaryList,
  readDreamEntry,
  readDreamList,
  readInterestHistorySnapshots,
  readPushHistoryItems,
  readTenantInterestGraph,
  readTenantStateSnapshot,
  readWanderFootprint,
  type DiaryEntry,
} from '../infra/tenant-data-reader.js';

export interface DataServiceDeps {
  config: Pick<ControlPlaneConfig, 'dataDir'>;
}

/** 数据读取没有 4xx 分支：成功带数据，失败一律 500（损坏不可读） */
export type DataOutcome<T> = { ok: true; data: T } | { ok: false; status: 500; error: string };

export interface HistoryPage {
  page: SpeakHistoryItem[];
  pagination: { total: number; offset: number; limit: number; hasMore: boolean };
}

export type { DiaryEntry };

export function createDataService({ config }: DataServiceDeps) {
  /** Agent 当前状态：数值取 pets 表（唯一真相源），叙事字段留 agent 文件；
   * mood/temper 未迁移（null）时保持文件值（迁移窗口期的展示妥协）。
   * 租户尚未游荡（无 state.json）→ null。 */
  async function getState(tenantId: string): Promise<DataOutcome<unknown>> {
    try {
      const state = await readTenantStateSnapshot(config.dataDir, tenantId);
      if (!state) return { ok: true, data: null };

      const db = await getDb(config.dataDir);
      const pet = await petsRepo.findPetByTenant(db, tenantId);
      if (pet && pet.mood !== null && pet.temper !== null) {
        state.energy = pet.energy;
        state.boredom = pet.boredom;
        state.mood = pet.mood;
        state.temper = pet.temper;
      }
      return { ok: true, data: state };
    } catch (error) {
      console.error('[data] /api/state 读取失败：', error);
      return { ok: false, status: 500, error: '状态数据损坏或不可读' };
    }
  }

  /** 兴趣图谱 + Shannon 熵（公式单一真相源 shared；展示层保留 3 位小数） */
  async function getInterests(tenantId: string): Promise<DataOutcome<unknown>> {
    let graph: { nodes: Array<{ weight: number }>; lastUpdated: string | null };
    try {
      graph = await readTenantInterestGraph(config.dataDir, tenantId);
    } catch (error) {
      console.error('[data] user-interests.json 读取失败：', error);
      return { ok: false, status: 500, error: '兴趣图谱数据损坏或不可读' };
    }

    const weights = graph.nodes.map((n) => n.weight).filter((w) => w > 0);
    return {
      ok: true,
      data: {
        nodes: graph.nodes,
        entropy: Math.round(shannonEntropy(weights) * 1000) / 1000,
        nodeCount: graph.nodes.length,
        lastUpdated: graph.lastUpdated,
      },
    };
  }

  /** 兴趣权重时间序列（最近 limit 条） */
  async function getInterestsHistory(tenantId: string, limit: number): Promise<DataOutcome<unknown>> {
    let snapshots: unknown[];
    try {
      snapshots = await readInterestHistorySnapshots(config.dataDir, tenantId);
    } catch (error) {
      console.error('[data] interest-history.jsonl 读取失败：', error);
      return { ok: false, status: 500, error: '兴趣历史数据损坏或不可读' };
    }
    return { ok: true, data: snapshots.slice(-limit) };
  }

  /** 历史推送记录（时间倒序 + 分页契约：total/hasMore 基于全部记录） */
  async function getHistory(
    tenantId: string,
    limit: number,
    offset: number,
  ): Promise<DataOutcome<HistoryPage>> {
    let items: SpeakHistoryItem[];
    try {
      items = await readPushHistoryItems(config.dataDir, tenantId);
    } catch (error) {
      // 读边界的目录/文件错误已带上下文记日志，这里取响应文案（'历史目录不可读' 等）
      return {
        ok: false,
        status: 500,
        error: error instanceof Error ? error.message : '历史记录不可读',
      };
    }
    items.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    const total = items.length;
    return {
      ok: true,
      data: {
        page: items.slice(offset, offset + limit),
        pagination: { total, offset, limit, hasMore: offset + limit < total },
      },
    };
  }

  /** 游荡足迹（全部步骤，时间正序——时间线消费方免排序） */
  async function getFootprint(tenantId: string): Promise<DataOutcome<unknown>> {
    let steps: unknown[];
    try {
      steps = await readWanderFootprint(config.dataDir, tenantId);
    } catch (error) {
      // 读边界已记日志并带文案抛出（损坏/形状非法）
      return {
        ok: false,
        status: 500,
        error: error instanceof Error ? error.message : '足迹数据损坏或不可读',
      };
    }
    const sorted = [...steps].sort((a, b) => {
      const ta = new Date(String((a as { timestamp?: unknown }).timestamp)).getTime();
      const tb = new Date(String((b as { timestamp?: unknown }).timestamp)).getTime();
      return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
    });
    return { ok: true, data: sorted };
  }

  /** 日记列表（时间倒序，含标题/摘录） */
  async function getDiaryList(tenantId: string): Promise<DataOutcome<DiaryEntry[]>> {
    try {
      return { ok: true, data: await readDiaryList(config.dataDir, tenantId) };
    } catch (error) {
      return {
        ok: false,
        status: 500,
        error: error instanceof Error ? error.message : '日记数据损坏或不可读',
      };
    }
  }

  /** 单篇日记；该日期没有 → found: false（路由层映射 404） */
  async function getDiaryEntry(
    tenantId: string,
    date: string,
  ): Promise<
    | { ok: true; data: DiaryEntry | null; found: boolean }
    | { ok: false; status: 500; error: string }
  > {
    let entry: DiaryEntry | null;
    try {
      entry = await readDiaryEntry(config.dataDir, tenantId, date);
    } catch (error) {
      return {
        ok: false,
        status: 500,
        error: error instanceof Error ? error.message : '日记数据损坏或不可读',
      };
    }
    return { ok: true, data: entry, found: entry !== null };
  }

  /** 梦境列表（diary/dreams/，与日记同契约：时间倒序含标题/摘录） */
  async function getDreamList(tenantId: string): Promise<DataOutcome<DiaryEntry[]>> {
    try {
      return { ok: true, data: await readDreamList(config.dataDir, tenantId) };
    } catch (error) {
      return {
        ok: false,
        status: 500,
        error: error instanceof Error ? error.message : '梦境数据损坏或不可读',
      };
    }
  }

  /** 单篇梦境；该日期没有 → found: false（路由层映射 404） */
  async function getDreamEntry(
    tenantId: string,
    date: string,
  ): Promise<
    | { ok: true; data: DiaryEntry | null; found: boolean }
    | { ok: false; status: 500; error: string }
  > {
    let entry: DiaryEntry | null;
    try {
      entry = await readDreamEntry(config.dataDir, tenantId, date);
    } catch (error) {
      return {
        ok: false,
        status: 500,
        error: error instanceof Error ? error.message : '梦境数据损坏或不可读',
      };
    }
    return { ok: true, data: entry, found: entry !== null };
  }

  return {
    getState,
    getInterests,
    getInterestsHistory,
    getHistory,
    getFootprint,
    getDiaryList,
    getDiaryEntry,
    getDreamList,
    getDreamEntry,
  };
}

export type DataService = ReturnType<typeof createDataService>;
