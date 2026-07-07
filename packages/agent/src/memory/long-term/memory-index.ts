/**
 * JSON sidecar 索引模块（MEM-01）。
 *
 * Markdown 是真相源，.index.json 是查询索引派生层，双写由
 * MemoryStore.updateIndexAfterSave 维护。
 *
 * 三个核心约束：
 * - 原子写 + 并发安全：唯一 tmp 名 + persist 串行 + 首次加载去重
 * - 崩溃自愈：索引缺失/schema 漂移 → rebuildIndexFromMarkdown 从 Markdown 重建
 * - D-09 错误显式化：文件不存在返空（合法），解析/schema 失败抛错（不兜底）
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

// schema 漂移守卫：改值 → 旧索引被 reject → 触发重建（Pitfall 5）
const INDEX_VERSION = 1 as const;

// 显式枚举四个子目录键，禁通配（Pitfall 6 / A3）
const MEMORY_TYPE_KEYS = Object.keys(MEMORY_TYPE_PATHS) as MemoryType[];

// parseMemoryFrontmatter 不返 accessedAt，需从 frontmatter 原文提取（Pitfall 4）
function extractAccessedAtFromContent(
  content: string,
  fallback: string,
): string {
  const match = content.match(/^accessedAt:\s*(.+)$/m);
  return match?.[1]?.trim() || fallback;
}

/** 返回空索引（不落盘，调用方决定何时 persist） */
export function createDefaultJsonIndex(): MemoryJsonIndex {
  return {
    version: INDEX_VERSION,
    lastUpdated: new Date().toISOString(),
    records: [],
  };
}

/**
 * 加载 .index.json。文件不存在返空（合法），解析/schema 失败抛错。
 * @throws Error JSON 非法或 schema 不匹配——不兜底返默认（D-09 / CLAUDE.md 红线）。
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
 * 原子写入 .index.json（temp-file + rename）。
 * 并发安全：tmp 名带 pid+时间戳+随机，并发 persist 互不覆盖（固定 .tmp 在 ReAct
 * 并行 tool call 实测场景下 rename ENOENT 导致 FATAL record_knowledge 失败）。
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
 * 从 Markdown 真相源重建索引记录。
 * 仅扫 MEMORY_TYPE_PATHS 四个子目录（禁递归），天然不扫 .archive/（Pitfall 6/A3）。
 * 同步迁移 frontmatter accessedAt（Pitfall 4）。
 * @throws Error 子目录 readFile/parse 失败——不兜底跳过（D-09）。
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

// fields self-documenting
export interface QueryRecentOptions {
  count?: number;
  type?: MemoryType;
  since?: string;
}

/**
 * JSON sidecar 索引读写类。
 *
 * 写方法仅改内存，由调用方统一调 persist() 落盘（避免每次 upsert 都写盘）。
 * 模块级单例（getMemoryIndex），仿 getMemoryStore / url-tracker 模式。
 */
export class MemoryIndex {
  private readonly jsonPath: string;
  private readonly basePath: string;
  private store: MemoryJsonIndex | null = null;
  // 并发 persist 串行排队（与 saveJsonIndex 唯一 tmp 双保险）
  private persistChain: Promise<void> = Promise.resolve();

  constructor(jsonPath: string, basePath: string) {
    this.jsonPath = jsonPath;
    this.basePath = basePath;
  }

  // 首次加载 in-flight 去重：并发 ensureLoaded 共享同一个 loadPromise
  private loadPromise: Promise<MemoryJsonIndex> | null = null;

  /**
   * 懒加载索引。
   * 并发去重：多个 ensureLoaded 同时进入共享 loadPromise，防止各自 loadJsonIndex
   * 创建多个 store 互相覆盖（并发首次加载的实测 bug）。失败清空 loadPromise 允许重试。
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
          this.loadPromise = null; // 失败清空 loadPromise，允许后续重试
          throw e;
        });
    }
    return this.loadPromise;
  }

  // 返回当前内存 store 的 records 快照（非持久化，调用方决定何时 persist）
  async getRecords(): Promise<MemoryIndexRecord[]> {
    const store = await this.ensureLoaded();
    return store.records;
  }

  /** 写入或更新一条索引记录。存在则更新，不存在则追加。仅改内存。 */
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

  /** 按 id 删除索引记录。不存在的 id 不抛错（幂等）。 */
  async remove(type: MemoryType, id: string): Promise<void> {
    const store = await this.ensureLoaded();
    store.records = store.records.filter((r) => !(r.id === id && r.type === type));
    store.lastUpdated = new Date().toISOString();
  }

  /**
   * 查询最近记忆（timestamp 降序 + type/since 过滤 + count 裁剪）。
   * 仅返回索引字段（不读 Markdown），O(1) 查表。
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

  // 更新 accessedAt 为当前时间；找不到不抛错（best-effort）
  async touchAccessedAt(type: MemoryType, id: string): Promise<void> {
    const store = await this.ensureLoaded();
    const rec = store.records.find((r) => r.id === id && r.type === type);
    if (!rec) return;
    rec.accessedAt = new Date().toISOString();
    store.lastUpdated = rec.accessedAt;
  }

  // 读取 accessedAt；不存在返 null（not found 合法空值）
  async getAccessedAt(type: MemoryType, id: string): Promise<string | null> {
    const store = await this.ensureLoaded();
    const rec = store.records.find((r) => r.id === id && r.type === type);
    return rec?.accessedAt ?? null;
  }

  /** 从 Markdown 重建并立即 persist。失败抛错（D-09），调用方 try/catch 降级为 warn。 */
  async rebuild(): Promise<void> {
    this.store = await rebuildIndexFromMarkdown(this.basePath);
    await this.persist();
  }

  /**
   * 持久化到磁盘（原子写 + 串行化）。
   * 所有 persist 经 promise 链排队，防并发竞争。失败仅向当前调用方抛，链不断。
   */
  async persist(): Promise<void> {
    const next = this.persistChain.then(async () => {
      const store = await this.ensureLoaded();
      await saveJsonIndex(this.jsonPath, store);
    });
    // 链不断：失败只抛给当前调用方，不污染后续 persist 排队
    this.persistChain = next.catch(() => {});
    return next;
  }
}

let defaultMemoryIndex: MemoryIndex | null = null;

/** 获取模块级单例（jsonPath/basePath 默认指向 data/memory） */
export function getMemoryIndex(basePath = 'data/memory'): MemoryIndex {
  if (!defaultMemoryIndex) {
    defaultMemoryIndex = new MemoryIndex(join(basePath, '.index.json'), basePath);
  }
  return defaultMemoryIndex;
}

/** 重置模块级单例（测试隔离用） */
export function _resetMemoryIndex(): void {
  defaultMemoryIndex = null;
}