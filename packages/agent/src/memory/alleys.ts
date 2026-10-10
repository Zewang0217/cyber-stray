/**
 * 巷子清单（alleys.json）——宠物自命名主题的导航清单。
 *
 * 用途：游荡时 LLM 每步上报所在巷子名，本模块负责归一（大小写/空白归并、
 * 新名追加、LRU 淘汰），保证足迹地图的泳道稳定不碎裂。
 * 它是导航清单不是记忆，故不进 MemoryIndex。
 * 不做模糊匹配合并——近义异名（"量子巷"/"量子深巷"）合不出正确结果，
 * 一致性靠 prompt 注入清单让 LLM 优先复用。
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { z } from 'zod';
import { getDataPath } from '../config.js';
import { atomicWriteJson } from '../utils/atomic-json.js';

/** 清单上限：泳道超过这个数地图就没法看了 */
export const MAX_ALLEYS = 30;
/** 单条巷子名长度上限（约束 LLM 自由发挥） */
export const MAX_ALLEY_NAME_LENGTH = 20;

export const AlleySchema = z.object({
  name: z.string().min(1).max(MAX_ALLEY_NAME_LENGTH),
  lastUsedAt: z.string(),
});
export type Alley = z.infer<typeof AlleySchema>;

export const AlleyListSchema = z.object({ alleys: z.array(AlleySchema) });
export type AlleyList = z.infer<typeof AlleyListSchema>;

/** 工具入参的 alley 字段（各轨迹工具共享同一描述，保证 LLM 看到一致约束） */
export const AlleyInputSchema = z.string().max(MAX_ALLEY_NAME_LENGTH).optional()
  .describe('你当前所在的巷子名：优先复用已有巷子清单里的名字；进入新主题时可起一个 ≤20 字的新名；与上一步相同可省略');

function alleysFilePath(): string {
  return getDataPath('alleys.json');
}

/** 读取巷子清单；文件不存在 = 空清单，脏数据直接抛错（不兜底掩盖） */
export async function loadAlleys(): Promise<AlleyList> {
  const path = alleysFilePath();
  if (!existsSync(path)) return { alleys: [] };
  return AlleyListSchema.parse(JSON.parse(await readFile(path, 'utf-8')));
}

/** 归一化比较键：大小写与首尾空白不影响同一巷子 */
function keyOf(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * 归一 LLM 上报的巷子名并落盘。
 * - raw 为空 / 超长 → 返回 fallback（本游荡上一步的巷子）
 * - 命中已有（大小写/空白不敏感）→ 归一到清单里的写法并刷新 LRU 位
 * - 新名 → 追加；超上限淘汰最久未用的
 */
export async function resolveAlley(raw: string | undefined, fallback?: string): Promise<string | undefined> {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed.length > MAX_ALLEY_NAME_LENGTH) return fallback;

  const list = await loadAlleys();
  const now = new Date().toISOString();
  const key = keyOf(trimmed);
  const hit = list.alleys.find((a) => keyOf(a.name) === key);

  if (hit) {
    // 数组序即 LRU 序：命中移到末尾，淘汰时从头删（不依赖时间戳精度）
    hit.lastUsedAt = now;
    list.alleys = list.alleys.filter((a) => a !== hit);
    list.alleys.push(hit);
    await atomicWriteJson(alleysFilePath(), list);
    return hit.name;
  }

  list.alleys.push({ name: trimmed, lastUsedAt: now });
  if (list.alleys.length > MAX_ALLEYS) list.alleys.shift();
  await atomicWriteJson(alleysFilePath(), list);
  return trimmed;
}

/** prompt 注入用：现有巷子名列表 */
export function formatAlleyListForPrompt(list: AlleyList): string {
  if (list.alleys.length === 0) return '（还没有去过任何巷子）';
  return list.alleys.map((a) => `- ${a.name}`).join('\n');
}
