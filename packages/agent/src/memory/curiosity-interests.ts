/**
 * 宠物好奇图谱（Curiosity Graph）骨架
 *
 * S1（#150）只建数据模型：schema + 默认骨架 + load/save，S4 接入读写。
 *
 * 字段语义（S4 反思修复 + selfInterest）：
 * - exploreCount：游荡/探索计数，反思时对探索到的新话题累加
 * - selfInterest：反思时 LLM 自我判断"我是否感兴趣"（依据性格 novelty/familiarity
 *   参数 + 记忆积累），0-1 分数；高分 → 说话更热情、更愿深挖
 *
 * 读写与 interest-graph 同模式：原子写 + schema 漂移守卫 + 文件不存在返骨架（合法）。
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { z } from 'zod';
import { consola } from '../logger.js';
import { getDataPath } from '../config.js';
import { atomicWriteJson } from '../utils/atomic-json.js';

const logger = consola.withTag('CuriosityGraph');

/** 骨架文件路径（调用时求值：测试在 import 后才设置 DATA_DIR） */
export function curiosityFilePath(): string {
  return getDataPath('curiosity-interests.json');
}

// Zod Schema（防 schema 漂移）

export const CuriosityNodeSchema = z.object({
  /** 节点 id（叶子路径，如 `天文/黑洞`；一级节点 = 路径自身） */
  id: z.string().min(1),
  /** taxonomy 路径 */
  path: z.string().min(1),
  /** 父节点 id；一级节点（根）缺省 */
  parent: z.string().optional(),
  /** 游荡/探索计数（S4 反思时累加） */
  exploreCount: z.number().int().min(0),
  /** 自我兴趣分数 0-1（S4 反思时 LLM 判断） */
  selfInterest: z.number().min(0).max(1),
  source: z.enum(['default', 'reflection', 'exploration', 'migration']),
  /** 上次探索时间 */
  lastExplored: z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), {
    message: 'lastExplored must be a valid date string',
  }),
});

export const CuriosityGraphDataSchema = z.object({
  version: z.literal(1),
  lastUpdated: z.string(),
  nodes: z.array(CuriosityNodeSchema),
});

// Types

export type CuriositySource = 'default' | 'reflection' | 'exploration' | 'migration';

export interface CuriosityNode {
  id: string;
  path: string;
  parent?: string;
  exploreCount: number;
  selfInterest: number;
  source: CuriositySource;
  lastExplored: string;
}

export interface CuriosityGraphData {
  version: 1;
  lastUpdated: string;
  nodes: CuriosityNode[];
}

// 默认骨架 / 读写

/** 空骨架（文件不存在或首次初始化时的合法状态） */
export function createDefaultCuriosityData(): CuriosityGraphData {
  return {
    version: 1,
    lastUpdated: new Date().toISOString(),
    nodes: [],
  };
}


/**
 * 加载好奇图谱。
 * 文件不存在 → 返回空骨架（首次运行，合法）；解析/schema 失败 → 抛错（D-09 不兜底）。
 */
export async function loadCuriosityGraph(): Promise<CuriosityGraphData> {
  const path = curiosityFilePath();
  if (!existsSync(path)) {
    logger.debug('好奇图谱文件不存在，返回空骨架');
    return createDefaultCuriosityData();
  }

  let content: string;
  try {
    content = await readFile(path, 'utf-8');
  } catch (error) {
    logger.error('读取好奇图谱失败', { path, error });
    throw new Error(`好奇图谱读取失败: ${path}`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    logger.error('好奇图谱解析失败（非法 JSON）', { path, error });
    throw new Error(`好奇图谱解析失败: ${path}`, { cause: error });
  }

  const result = CuriosityGraphDataSchema.safeParse(parsed);
  if (!result.success) {
    logger.error('好奇图谱 schema 校验失败', {
      path,
      issues: result.error.issues,
    });
    throw new Error(`好奇图谱 schema 校验失败: ${path}`, { cause: result.error });
  }

  return result.data;
}

/** 持久化好奇图谱（原子写） */
export async function saveCuriosityGraph(data: CuriosityGraphData): Promise<void> {
  await atomicWriteJson(curiosityFilePath(), data);
}