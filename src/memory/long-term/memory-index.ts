/**
 * 长期记忆 JSON sidecar 索引模块（MEM-01）
 *
 * 在 Markdown 真相源（data/memory/<type>/*.md）之上提供可查询的 JSON 索引
 * （data/memory/.index.json），消除检索/反思的 O(N) 全文件扫描。
 *
 * 设计要点：
 * - **Markdown 是真相源**，JSON 是查询索引派生层；双写由 MemoryStore 的
 *   `updateIndexAfterSave` 钩子维护。
 * - **原子写**：temp-file + `rename`（同目录保证同文件系统，RESEARCH Pattern 2）。
 * - **崩溃自愈**：启动时若 `.index.json` 缺失或 schema 不匹配，调
 *   `rebuildIndexFromMarkdown()` 从 Markdown 重建（RESEARCH Pitfall 3）。
 * - **D-09 错误显式化**：`loadJsonIndex` 区分 "not found → 返默认空索引" 与
 *   "解析失败 → 抛 Error"（不兜底返默认，CLAUDE.md 红线）。
 * - **accessedAt 迁移**：从 Markdown frontmatter 读出写入索引（Pitfall 4 防丢历史）。
 */

import { readFile, writeFile, rename, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { consola } from '../../logger.js';
import type {
  MemoryEntry,
  MemoryType,
  MemoryIndexRecord,
  MemoryJsonIndex,
} from './types.js';
import {
  MEMORY_TYPE_PATHS,
  parseMemoryFrontmatter,
  MemoryJsonIndexSchema,
} from './types.js';

const logger = consola.withTag('MemoryIndex');

/** 索引文件版本字面量（防 schema 漂移，RESEARCH Pitfall 5） */
const INDEX_VERSION = 1 as const;

/** 排序/重建扫描的 MEMORY_TYPE_PATHS 子目录键（显式枚举，禁通配，Pitfall 6） */
const MEMORY_TYPE_KEYS = Object.keys(MEMORY_TYPE_PATHS) as MemoryType[];

/** 从 Markdown frontmatter 文本直接提取 accessedAt（parseMemoryFrontmatter 不返回该字段） */
function extractAccessedAtFromContent(
  content: string,
  fallback: string,
): string {
  const match = content.match(/^accessedAt:\s*(.+)$/m);
  return match?.[1]?.trim() || fallback;
}

/** 构造一个空的默认索引（不落盘，由调用方决定是否 persist） */
export function createDefaultJsonIndex(): MemoryJsonIndex {
  return {
    version: INDEX_VERSION,
    lastUpdated: new Date().toISOString(),
    records: [],
  };
}

/**
 * 加载 JSON sidecar 索引
 *
 * - 文件不存在 → 返默认空索引（**not found 合法空值**，不落盘）
 * - 文件存在且合法 → Zod schema 校验通过后返回
 * - JSON.parse 失败 / Zod 校验失败 → **抛 Error（不兜底返默认，D-09）**
 *
 * @throws Error 当文件存在但非法（JSON.parse 失败或 schema 不匹配）
 */
export async function loadJsonIndex(path: string): Promise<MemoryJsonIndex> {
  if (!existsSync(path)) {
    return createDefaultJsonIndex();
  }

  let content: string;
  try {
    content = await readFile(path, 'utf-8');
  } catch (error) {
    logger.error('读取 JSON 索引文件失败', { path, error });
    throw new Error(`JSON 索引读取失败: ${path}`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    logger.error('JSON 索引解析失败（非法 JSON）', { path, error });
    throw new Error(`JSON 索引解析失败: ${path}`, { cause: error });
  }

  const result = MemoryJsonIndexSchema.safeParse(parsed);
  if (!result.success) {
    logger.error('JSON 索引 schema 校验失败（version/records 等字段漂移）', {
      path,
      issues: result.error.issues,
    });
    throw new Error(`JSON 索引 schema 校验失败: ${path}`, {
      cause: result.error,
    });
  }

  return result.data;
}

/**
 * 原子写入 JSON sidecar 索引（temp-file + rename，RESEARCH Pattern 2）
 *
 * 临时文件与目标文件在同一目录（保证同文件系统，`rename` 原子性前提）。
 * 读者要么读到旧版、要么读到新版、绝不读到半写。
 *
 * **并发安全**：tmp 名带 pid + 时间戳 + 随机后缀，并发 persist 各写各的 tmp
 * 互不覆盖；固定 `.tmp` 名会在并发 rename 时 ENOENT（ReAct 一步内并行多个
 * 写工具 → 并发 saveMemory → persist 的实测 FATAL 场景）。
 */
export async function saveJsonIndex(
  path: string,
  data: MemoryJsonIndex,
): Promise<void> {
  // 唯一 tmp 名：防并发 persist 竞争固定 .tmp 导致 rename ENOENT
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = JSON.stringify(data, null, 2);
  await writeFile(tmp, payload, 'utf-8');
  await rename(tmp, path);
}

/**
 * 从 Markdown 真相源重建索引记录
 *
 * **仅扫描 MEMORY_TYPE_PATHS 的四个明确子目录**（禁递归、禁通配），
 * 天然不扫 `.archive/`（Pitfall 6 / A3）。读取每个 Markdown 的 frontmatter
 * 构造 `MemoryIndexRecord`，并迁移 frontmatter 中的 accessedAt（Pitfall 4）。
 *
 * @throws Error 当子目录 readFile / parse 失败（不兜底跳过，D-09）
 */
export async function rebuildIndexFromMarkdown(
  basePath: string,
): Promise<MemoryJsonIndex> {
  const records: MemoryIndexRecord[] = [];

  for (const type of MEMORY_TYPE_KEYS) {
    const subdir = MEMORY_TYPE_PATHS[type];
    const dir = join(basePath, subdir);
    if (!existsSync(dir)) continue;

    const files = await readdir(dir);
    const mdFiles = files.filter((f) => f.endsWith('.md'));

    for (const file of mdFiles) {
      const filepath = join(dir, file);
      const content = await readFile(filepath, 'utf-8');
      const parsed = parseMemoryFrontmatter(content);
      records.push({
        id: file.replace(/\.md$/, ''),
        type,
        timestamp: parsed.timestamp,
        accessedAt: extractAccessedAtFromContent(content, parsed.timestamp),
        importance: parsed.importance,
        tags: parsed.tags,
        summary: parsed.summary,
        filepath: `${subdir}/${file}`,
      });
    }
  }

  return {
    version: INDEX_VERSION,
    lastUpdated: new Date().toISOString(),
    records,
  };
}

/** queryRecent 的过滤选项 */
export interface QueryRecentOptions {
  count?: number;
  type?: MemoryType;
  since?: string;
}

/**
 * MemoryIndex：JSON sidecar 索引读写类（懒加载 + 模块级单例）
 *
 * 写方法（upsert/remove/touchAccessedAt）仅改内存 store，由调用方在
 * 钩子末尾统一调一次 `persist()`（避免每次 upsert 都写盘）。
 */
export class MemoryIndex {
  private readonly jsonPath: string;
  private readonly basePath: string;
  private store: MemoryJsonIndex | null = null;
  /** persist 串行化链：并发 persist 排队执行防竞争（与 saveJsonIndex 唯一 tmp 名双保险） */
  private persistChain: Promise<void> = Promise.resolve();

  constructor(jsonPath: string, basePath: string) {
    this.jsonPath = jsonPath;
    this.basePath = basePath;
  }

  /** 加载 in-flight promise（并发首次加载去重） */
  private loadPromise: Promise<MemoryJsonIndex> | null = null;

  /**
   * 懒加载索引（首次访问从磁盘读，失败抛错 D-09）
   *
   * 并发去重：多个 ensureLoaded 同时在 store 未加载时进入，共享同一个 loadPromise，
   * 避免各自 loadJsonIndex 创建多个 store 对象、this.store 被反复覆盖、upsert 改到
   * 孤立 store（MEM-01 并发安全）。加载失败清空 loadPromise 允许重试。
   */
  private async ensureLoaded(): Promise<MemoryJsonIndex> {
    if (this.store !== null) return this.store;
    if (this.loadPromise === null) {
      this.loadPromise = loadJsonIndex(this.jsonPath)
        .then((s) => {
          this.store = s;
          return s;
        })
        .catch((e) => {
          this.loadPromise = null; // 失败清空，允许后续重试（D-09 错误仍向上抛）
          throw e;
        });
    }
    return this.loadPromise;
  }

  /** 当前内存中的 records（非持久化快照） */
  async getRecords(): Promise<MemoryIndexRecord[]> {
    const store = await this.ensureLoaded();
    return store.records;
  }

  /**
   * 写入或更新一条索引记录（存在则更新、不存在则追加）
   *
   * 仅改内存；由调用方调 `persist()` 落盘。
   */
  async upsert(entry: MemoryEntry): Promise<void> {
    const store = await this.ensureLoaded();
    const filepath = `${MEMORY_TYPE_PATHS[entry.type]}/${entry.id}.md`;
    const record: MemoryIndexRecord = {
      id: entry.id,
      type: entry.type,
      timestamp: entry.timestamp,
      accessedAt: entry.accessedAt ?? entry.timestamp,
      importance: entry.importance,
      tags: entry.tags,
      summary: entry.summary,
      filepath,
    };

    const idx = store.records.findIndex((r) => r.id === entry.id);
    if (idx >= 0) {
      store.records[idx] = record;
    } else {
      store.records.push(record);
    }
    store.lastUpdated = new Date().toISOString();
  }

  /** 按 id 删除索引记录；不存在的 id 不抛错（幂等） */
  async remove(type: MemoryType, id: string): Promise<void> {
    const store = await this.ensureLoaded();
    store.records = store.records.filter((r) => !(r.id === id && r.type === type));
    store.lastUpdated = new Date().toISOString();
  }

  /**
   * 查询最近记忆（按 timestamp 降序 + type/since 过滤 + count 裁剪）
   *
   * 返回 `MemoryIndexRecord[]`（仅索引字段，**不读 Markdown**，O(1) 索引查表）。
   */
  async queryRecent(options: QueryRecentOptions = {}): Promise<MemoryIndexRecord[]> {
    const { count = 20, type, since } = options;
    const store = await this.ensureLoaded();

    return store.records
      .filter((r) => (type ? r.type === type : true))
      .filter((r) => (since ? r.timestamp >= since : true))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, count);
  }

  /** 更新该条 accessedAt 为 now；找不到条目不抛错（best-effort） */
  async touchAccessedAt(type: MemoryType, id: string): Promise<void> {
    const store = await this.ensureLoaded();
    const rec = store.records.find((r) => r.id === id && r.type === type);
    if (!rec) return;
    rec.accessedAt = new Date().toISOString();
    store.lastUpdated = rec.accessedAt;
  }

  /** 读取该条 accessedAt；不存在返 null（not found 合法空值） */
  async getAccessedAt(type: MemoryType, id: string): Promise<string | null> {
    const store = await this.ensureLoaded();
    const rec = store.records.find((r) => r.id === id && r.type === type);
    return rec?.accessedAt ?? null;
  }

  /**
   * 从 Markdown 重建索引（崩溃自愈 / schema 漂移修复）
   *
   * 重建后**立即 persist**（让磁盘 .index.json 与 Markdown 一致）。
   * 失败抛错（D-09），调用方可 try/catch 降级为 warn 不阻断（RESEARCH Pitfall 3）。
   */
  async rebuild(): Promise<void> {
    this.store = await rebuildIndexFromMarkdown(this.basePath);
    await this.persist();
  }

  /**
   * 持久化内存 store 到磁盘（原子写 + 串行化）
   *
   * 串行化：所有 persist 经 promise 链排队执行，防并发 persist 竞争。
   * 调用方收到各自真实结果；链本身不被前次失败打断（失败仅向当前调用方抛）。
   */
  async persist(): Promise<void> {
    const next = this.persistChain.then(async () => {
      const store = await this.ensureLoaded();
      await saveJsonIndex(this.jsonPath, store);
    });
    // 链不断：失败只抛给当前调用方，不污染后续 persist 排队（避免 unhandledRejection）
    this.persistChain = next.catch(() => {});
    return next;
  }
}

// ============================================
// 模块级单例（仿 getMemoryStore / url-tracker 模式）
// ============================================

let defaultMemoryIndex: MemoryIndex | null = null;

/**
 * 获取/创建模块级单例 MemoryIndex（jsonPath/basePath 默认指向 data/memory）
 */
export function getMemoryIndex(basePath = 'data/memory'): MemoryIndex {
  if (!defaultMemoryIndex) {
    defaultMemoryIndex = new MemoryIndex(join(basePath, '.index.json'), basePath);
  }
  return defaultMemoryIndex;
}

/**
 * 重置模块级单例（测试隔离用，仿 react.ts 的 `_resetReactModuleState`）
 */
export function _resetMemoryIndex(): void {
  defaultMemoryIndex = null;
}
