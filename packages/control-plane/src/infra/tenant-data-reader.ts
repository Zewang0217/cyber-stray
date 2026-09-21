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
import { isEnoent } from './enoent.js';
import { tenantDataDir } from '../tenant.js';

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

/** 游荡足迹（wander-history.json 全部步骤）；缺失 → []；损坏/形状非法显式抛 */
export async function readWanderFootprint(dataDir: string, tenantId: string): Promise<unknown[]> {
  let content: string;
  try {
    content = await readFile(join(tenantDataDir(dataDir, tenantId), 'wander-history.json'), 'utf-8');
  } catch (error) {
    if (isEnoent(error)) return [];
    throw error;
  }
  let steps: unknown;
  try {
    steps = JSON.parse(content);
  } catch (error) {
    console.error('[footprint] wander-history.json 损坏：', error);
    throw new Error('足迹数据损坏或不可读');
  }
  if (!Array.isArray(steps)) {
    throw new Error('足迹数据格式非法（须为数组）');
  }
  return steps;
}

export interface DiaryEntry {
  date: string;
  title: string;
  content: string;
  excerpt?: string;
}

/** 解析 markdown 首个 `# ` 一级标题；缺省回退 fallback（日记='日记'，梦境='梦境'） */
function parseMarkdownTitle(content: string, fallback: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  const title = match?.[1]?.trim();
  return title && title.length > 0 ? title : fallback;
}

/** 摘录：去掉 markdown 装饰后的前 120 字 */
function markdownExcerpt(content: string, maxChars = 120): string {
  const plain = content
    .replace(/^#+\s+/gm, '')
    .replace(/[*_`>]|\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > maxChars ? `${plain.slice(0, maxChars)}…` : plain;
}

/** 日记日期合法性（YYYY-MM-DD，防路径穿越） */
const DIARY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 日记列表（时间倒序，含标题/摘录）；目录缺失 → []；单篇读失败显式抛 */
export async function readDiaryList(dataDir: string, tenantId: string): Promise<DiaryEntry[]> {
  const diaryDir = join(tenantDataDir(dataDir, tenantId), 'diary');
  let files: string[];
  try {
    files = (await readdir(diaryDir)).filter((f) => f.endsWith('.md'));
  } catch (error) {
    if (isEnoent(error)) return [];
    throw error;
  }

  const entries: DiaryEntry[] = [];
  for (const file of files) {
    const date = file.slice(0, -3); // 去 .md 后缀
    if (!DIARY_DATE_RE.test(date)) continue; // 非日期命名的 md 不当作日记
    try {
      const content = await readFile(join(diaryDir, file), 'utf-8');
      entries.push({
        date,
        title: parseMarkdownTitle(content, '日记'),
        content,
        excerpt: markdownExcerpt(content),
      });
    } catch (error) {
      console.error(`[diary] 读取 ${file} 失败：`, error);
      throw new Error('日记数据损坏或不可读');
    }
  }
  entries.sort((a, b) => (a.date < b.date ? 1 : -1)); // 时间倒序
  return entries;
}

/** 单篇日记；缺失 → null（该日期没有日记） */
export async function readDiaryEntry(
  dataDir: string,
  tenantId: string,
  date: string,
): Promise<DiaryEntry | null> {
  let content: string;
  try {
    content = await readFile(join(tenantDataDir(dataDir, tenantId), 'diary', `${date}.md`), 'utf-8');
  } catch (error) {
    if (isEnoent(error)) return null;
    throw error;
  }
  return { date, title: parseMarkdownTitle(content, '日记'), content };
}

/** 梦境列表（diary/dreams/，与日记同契约：时间倒序含标题/摘录）；缺失 → [] */
export async function readDreamList(dataDir: string, tenantId: string): Promise<DiaryEntry[]> {
  const dreamsDir = join(tenantDataDir(dataDir, tenantId), 'diary', 'dreams');
  let files: string[];
  try {
    files = (await readdir(dreamsDir)).filter((f) => f.endsWith('.md'));
  } catch (error) {
    if (isEnoent(error)) return [];
    throw error;
  }

  const entries: DiaryEntry[] = [];
  for (const file of files) {
    const date = file.slice(0, -3); // 去 .md 后缀
    if (!DIARY_DATE_RE.test(date)) continue; // 非日期命名的 md 不当作梦境
    try {
      const content = await readFile(join(dreamsDir, file), 'utf-8');
      entries.push({
        date,
        title: parseMarkdownTitle(content, '梦境'),
        content,
        excerpt: markdownExcerpt(content),
      });
    } catch (error) {
      console.error(`[dream] 读取 ${file} 失败：`, error);
      throw new Error('梦境数据损坏或不可读');
    }
  }
  entries.sort((a, b) => (a.date < b.date ? 1 : -1)); // 时间倒序
  return entries;
}

/** 单篇梦境；缺失 → null */
export async function readDreamEntry(
  dataDir: string,
  tenantId: string,
  date: string,
): Promise<DiaryEntry | null> {
  let content: string;
  try {
    content = await readFile(
      join(tenantDataDir(dataDir, tenantId), 'diary', 'dreams', `${date}.md`),
      'utf-8',
    );
  } catch (error) {
    if (isEnoent(error)) return null;
    throw error;
  }
  return { date, title: parseMarkdownTitle(content, '梦境'), content };
}

/**
 * 读租户目录下相对路径文件的字节（概念图等）；路径由调用方保证来自
 * 可信数据（如 DB 中的 conceptPath），缺失 → null。
 */
export async function readTenantFile(
  dataDir: string,
  tenantId: string,
  relativePath: string,
): Promise<Buffer | null> {
  try {
    return await readFile(join(tenantDataDir(dataDir, tenantId), relativePath));
  } catch (error) {
    if (isEnoent(error)) return null;
    throw error;
  }
}

/**
 * 租户素材文件字节（pet-assets 目录）；缺失 → null。调用方负责文件名白名单
 * 与路径归一化校验（接口层安全检查）。
 */
export async function readTenantAsset(
  dataDir: string,
  tenantId: string,
  relativePath: string,
): Promise<Buffer | null> {
  return readTenantFile(dataDir, tenantId, join('pet-assets', relativePath));
}
