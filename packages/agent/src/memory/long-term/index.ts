/**
 * 长期记忆存储核心模块
 *
 * 基于文件系统的记忆存储，采用 Markdown 格式：
 * - INDEX.md 作为总索引
 * - 按类型分类存储在子目录
 * - 每条记忆为一个 .md 文件
 */

import { readFile, writeFile, mkdir, readdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { consola } from '../../logger.js';

import type {
  MemoryEntry,
  MemoryType,
  MemoryIndex,
  MemoryContextOptions,
  MemoryConfig,
} from './types.js';
import {
  DEFAULT_MEMORY_CONFIG,
  MEMORY_TYPE_PATHS,
  generateMemoryId,
  toSafeFilename,
  parseMemoryFrontmatter,
  formatMemoryToMarkdown,
} from './types.js';
import { MemoryIndex as MemoryIndexStore, getMemoryIndex } from './memory-index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = consola.withTag('MemoryStore');

/**
 * 长期记忆存储管理器
 */
export class MemoryStore {
  private config: MemoryConfig;
  private indexCache: MemoryIndex | null = null;
  /** JSON sidecar 索引（检索走它，O(1) 查表替代 O(N) readdir 全扫） */
  private jsonIndex: MemoryIndexStore;

  constructor(config: Partial<MemoryConfig> = {}) {
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
    // 注入 JSON 索引（getMemoryIndex 单例按 basePath 复用；测试通过
    // _resetMemoryIndex 重置后再 new MemoryStore 以拿到对应 basePath 的实例）
    this.jsonIndex = getMemoryIndex(this.config.basePath);
  }

  /**
   * 获取基础路径
   */
  private getBasePath(...paths: string[]): string {
    return join(this.config.basePath, ...paths);
  }

  // ============================================
  // 索引操作
  // ============================================

  /**
   * 读取记忆索引（人类可读的 INDEX.md）
   *
   * D-09：文件不存在 → 返默认（合法空值）；读取/解析失败 → **抛 Error**（不兜底返默认）。
   */
  async readIndex(): Promise<MemoryIndex> {
    const indexPath = this.getBasePath('INDEX.md');

    if (!existsSync(indexPath)) {
      return this.createDefaultIndex();
    }

    let content: string;
    try {
      content = await readFile(indexPath, 'utf-8');
    } catch (error) {
      logger.error('读取 INDEX.md 失败', { indexPath, error });
      throw new Error(`INDEX.md 读取失败: ${indexPath}`, { cause: error });
    }

    // D-09：合法 INDEX.md 必须以已知标题开头。缺标题视为非法内容，抛错（不兜底返默认）
    if (!content.includes('# 赛博街溜子记忆系统')) {
      logger.error('INDEX.md 非法内容（缺标题标记）', { indexPath });
      throw new Error(`INDEX.md 解析失败（缺标题标记）: ${indexPath}`);
    }

    try {
      return this.parseIndexFromMarkdown(content);
    } catch (error) {
      logger.error('INDEX.md 解析失败', { indexPath, error });
      throw new Error(`INDEX.md 解析失败: ${indexPath}`, { cause: error });
    }
  }

  /**
   * 更新索引
   */
  async updateIndex(updates: Partial<MemoryIndex>): Promise<void> {
    const index = await this.readIndex();
    const newIndex = {
      ...index,
      ...updates,
      lastUpdated: new Date().toISOString(),
    };
    await this.writeIndex(newIndex);
    this.indexCache = newIndex;
  }

  /**
   * 写入索引文件（公开，供 MemoryConsolidator 等外部调用）
   */
  async writeIndex(index: MemoryIndex): Promise<void> {
    const indexPath = this.getBasePath('INDEX.md');
    const content = this.formatIndexToMarkdown(index);
    await this.ensureDir(this.getBasePath());
    await writeFile(indexPath, content, 'utf-8');
  }

  /**
   * 从 Markdown 解析索引
   */
  private parseIndexFromMarkdown(content: string): MemoryIndex {
    const lines = content.split('\n');
    const meta: Record<string, string> = {};
    const recentMemories: string[] = [];
    const importantMemories: string[] = [];
    const tags: string[] = [];
    let section: string | null = null;

    for (const line of lines) {
      // 检测章节
      if (line.startsWith('## 最近记忆')) {
        section = 'recent';
        continue;
      }
      if (line.startsWith('## 重要记忆')) {
        section = 'important';
        continue;
      }
      if (line.startsWith('## 标签')) {
        section = 'tags';
        continue;
      }
      if (line.startsWith('## ') || line.startsWith('# ')) {
        section = null;
        continue;
      }

      if (section === 'recent') {
        const match = line.match(/^\s*-\s*(.+)$/);
        if (match && match[1]) {
          recentMemories.push(match[1].trim());
        }
        continue;
      }
      if (section === 'important') {
        const match = line.match(/^\s*-\s*(.+)$/);
        if (match && match[1]) {
          importantMemories.push(match[1].trim());
        }
        continue;
      }
      if (section === 'tags') {
        const tagMatch = line.match(/^#(\S+)/);
        if (tagMatch && tagMatch[1]) {
          tags.push(tagMatch[1]);
        }
        continue;
      }

      // 概览区解析 key: value
      const metaMatch = line.match(/^\s*-\s*(\w+):\s*(.+)$/);
      if (metaMatch && metaMatch[1]) {
        meta[metaMatch[1]] = metaMatch[2] || '';
      }
    }

    return {
      lastUpdated: meta.lastUpdated || new Date().toISOString(),
      totalMemories: parseInt(meta.totalMemories || '0', 10),
      typeStats: this.parseTypeStats(meta.typeStats || ''),
      recentMemories,
      importantMemories,
      tags,
    };
  }

  /**
   * 将索引格式化为 Markdown
   */
  private formatIndexToMarkdown(index: MemoryIndex): string {
    const lines = [
      '# 赛博街溜子记忆系统',
      '',
      `> 最后更新: ${index.lastUpdated}`,
      '',
      '## 概览',
      // WR-06：概览区 key 用 ASCII（旧版中文 key `总记忆数/类型统计` 无法被
      // parseIndexFromMarkdown 的 \w+ 正则往返解析 → totalMemories 每次回环清零）。
      `- totalMemories: ${index.totalMemories}`,
      `- typeStats: ${JSON.stringify(index.typeStats)}`,
      '',
      '## 快速导航',
      '- [用户偏好](./profile/preferences.md)',
      '- [知识积累](./knowledge/insights.md)',
      '- [今日交互](./interactions/)',
      '- [用户观察](./observations/user-reactions.md)',
      '',
      '## 最近记忆',
      ...index.recentMemories.slice(0, 10).map((id) => `- ${id}`),
      '',
      '## 重要记忆',
      ...index.importantMemories.slice(0, 5).map((id) => `- ${id}`),
      '',
      '## 标签',
      ...index.tags.slice(0, 20).map((tag) => `#${tag}`),
    ];

    return lines.join('\n');
  }

  private parseTypeStats(str: string): Record<MemoryType, number> {
    try {
      return JSON.parse(str);
    } catch (error) {
      consola.warn('解析 typeStats 失败，计数器回退为 0', { raw: str, error });
      return { profile: 0, knowledge: 0, interaction: 0, observation: 0 };
    }
  }

  private createDefaultIndex(): MemoryIndex {
    return {
      lastUpdated: new Date().toISOString(),
      totalMemories: 0,
      typeStats: { profile: 0, knowledge: 0, interaction: 0, observation: 0 },
      recentMemories: [],
      importantMemories: [],
      tags: [],
    };
  }

  // ============================================
  // 记忆 CRUD
  // ============================================

  /**
   * 保存记忆条目
   */
  async saveMemory(entry: Omit<MemoryEntry, 'id'> & { id?: string }): Promise<MemoryEntry> {
    const id = entry.id ?? generateMemoryId(entry.type, entry.content);
    const fullEntry: MemoryEntry = { ...entry, id };

    const dir = this.getBasePath(MEMORY_TYPE_PATHS[entry.type]);
    const filename = `${toSafeFilename(id)}.md`;
    const filepath = join(dir, filename);

    await this.ensureDir(dir);
    const content = this.formatEntry(fullEntry);

    try {
      await writeFile(filepath, content, 'utf-8');
    } catch (error) {
      logger.error('写入记忆文件失败', { id, filepath, error });
      throw new Error(`记忆写入失败: ${id}`, { cause: error });
    }

    await this.updateIndexAfterSave(fullEntry);
    logger.debug('记忆已保存', { id, type: entry.type });

    return fullEntry;
  }

  /**
   * 读取单条记忆
   *
   * - 文件不存在 → 返 null（not found 合法空值，D-09）
   * - 读取/解析失败 → **抛 Error**（不返 null 兜底，D-09）
   * - **不再读即写**（写放大消除）：accessedAt 迁到 JSON 索引，读路径不重写文件
   */
  async getMemory(type: MemoryType, id: string): Promise<MemoryEntry | null> {
    const filepath = this.getMemoryPath(type, id);

    if (!existsSync(filepath)) {
      return null;
    }

    let content: string;
    try {
      content = await readFile(filepath, 'utf-8');
    } catch (error) {
      logger.error('读取记忆文件失败', { id, filepath, error });
      throw new Error(`记忆读取失败: ${id}`, { cause: error });
    }

    let entry: MemoryEntry;
    try {
      entry = this.parseMemoryFromMarkdown(content, id, type);
    } catch (error) {
      logger.error('记忆 Markdown 解析失败', { id, filepath, error });
      throw new Error(`记忆解析失败: ${id}`, { cause: error });
    }

    // accessedAt 迁到 JSON 索引：best-effort 更新（失败不阻断读，仅 warn）
    await this.jsonIndex.touchAccessedAt(type, id).catch((error) => {
      logger.warn('更新索引 accessedAt 失败', { id, error });
    });
    // 返回的 entry.accessedAt 优先读索引（若索引有），否则用 timestamp
    const indexed = await this.jsonIndex.getAccessedAt(type, id);
    entry.accessedAt = indexed ?? entry.timestamp;

    return entry;
  }

  /**
   * 获取最近记忆（走 JSON 索引，不再 readdir 全扫）
   *
   * 候选条目从 `jsonIndex.queryRecent()` 获取（O(1) 索引查表），仅对命中条目
   * 按需读 Markdown。文件读取失败 best-effort 跳过（索引滞后于磁盘的边界情况），
   * 不阻断检索。
   */
  async getRecentMemories(options: {
    count?: number;
    type?: MemoryType;
    since?: string;
  } = {}): Promise<MemoryEntry[]> {
    const { count = 20, type, since } = options;
    const records = await this.jsonIndex.queryRecent({ count, type, since });

    const memories: MemoryEntry[] = [];
    for (const rec of records) {
      try {
        const filepath = this.getBasePath(rec.filepath);
        const content = await readFile(filepath, 'utf-8');
        memories.push(this.parseMemoryFromMarkdown(content, rec.id, rec.type));
      } catch (error) {
        logger.warn('索引命中但 Markdown 读取失败，跳过', {
          id: rec.id,
          filepath: rec.filepath,
          error,
        });
      }
    }

    // queryRecent 已按 timestamp 降序；防御性二次裁剪（防磁盘解析过滤后超量）
    return memories.slice(0, count);
  }

  /**
   * 搜索记忆
   */
  async searchMemories(query: string): Promise<MemoryEntry[]> {
    const allMemories = await this.getRecentMemories({ count: 100 });
    const lowerQuery = query.toLowerCase();

    return allMemories.filter(
      (m) =>
        m.content.toLowerCase().includes(lowerQuery) ||
        m.summary.toLowerCase().includes(lowerQuery) ||
        m.tags.some((t) => t.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * 读取记忆的 accessedAt（从 JSON 索引，供 MemoryConsolidator 使用）
   *
   * accessedAt 已迁到 JSON 索引（01-01），不再存 Markdown frontmatter。
   * 返回 null 表示索引中无此条目（调用方应回退 timestamp）。
   */
  async getMemoryAccessedAt(type: MemoryType, id: string): Promise<string | null> {
    return this.jsonIndex.getAccessedAt(type, id);
  }

  /**
   * 从 INDEX.md + .index.json 剔除一条记忆的索引记录（文件删除/归档后调用）
   *
   * 抽取自 deleteMemory，供 MemoryConsolidator 归档时复用（CR-02：归档须联动索引，
   * 否则 .index.json 留孤儿记录 → getRecentMemories 读已归档文件静默丢结果）。
   */
  async unlinkFromIndex(type: MemoryType, id: string): Promise<void> {
    const index = await this.readIndex();
    index.totalMemories = Math.max(0, index.totalMemories - 1);
    index.typeStats[type] = Math.max(0, (index.typeStats[type] || 1) - 1);
    index.recentMemories = index.recentMemories.filter((memId) => memId !== id);
    index.importantMemories = index.importantMemories.filter((memId) => memId !== id);
    await this.writeIndex(index);

    // 索引联动：剔除 .index.json 中对应记录
    await this.jsonIndex.remove(type, id);
    await this.jsonIndex.persist();
  }

  /**
   * 删除记忆
   *
   * - 文件不存在 → 返 false（not found 合法空值，D-09）
   * - 删除/索引更新失败 → **抛 Error**（不返 false 兜底，D-09）
   * - 删 Markdown 后双写联动：INDEX.md + .index.json 同步剔除条目（复用 unlinkFromIndex）
   */
  async deleteMemory(type: MemoryType, id: string): Promise<boolean> {
    const filepath = this.getMemoryPath(type, id);

    if (!existsSync(filepath)) {
      return false;
    }

    try {
      await rm(filepath);
      logger.debug('记忆已删除', { id });

      await this.unlinkFromIndex(type, id);

      return true;
    } catch (error) {
      logger.error('删除记忆失败', { id, error });
      throw new Error(`记忆删除失败: ${id}`, { cause: error });
    }
  }

  /**
   * 启动期索引一致性校验与自愈（CR-01：兑现"崩溃自愈"承诺）
   *
   * - .index.json 缺失/损坏/空但 Markdown 存在 → 从 Markdown 重建
   * - 失败抛错，由调用方 best-effort 兜底（不阻断启动）
   */
  async ensureIndexConsistent(): Promise<void> {
    // 1. 尝试加载；schema 漂移/非法 JSON → rebuild
    try {
      await this.jsonIndex.getRecords();
    } catch (error) {
      logger.warn('JSON 索引异常，从 Markdown 重建', { error: String(error) });
      await this.jsonIndex.rebuild();
      return;
    }
    // 2. records 为空但 Markdown 存在 → rebuild（首次启动 / 索引文件丢失）
    const records = await this.jsonIndex.getRecords();
    if (records.length === 0) {
      const mdCount = await this.countMarkdownFiles();
      if (mdCount > 0) {
        logger.info('检测到 Markdown 但索引为空，触发 rebuild', { markdownFiles: mdCount });
        await this.jsonIndex.rebuild();
      }
    }
  }

  /** 统计四个类型子目录下的 Markdown 文件数（供 ensureIndexConsistent 判定是否需 rebuild） */
  private async countMarkdownFiles(): Promise<number> {
    let count = 0;
    for (const type of Object.keys(MEMORY_TYPE_PATHS) as MemoryType[]) {
      const dir = this.getBasePath(MEMORY_TYPE_PATHS[type]);
      if (!existsSync(dir)) continue;
      const files = await readdir(dir);
      count += files.filter((f) => f.endsWith('.md')).length;
    }
    return count;
  }

  // ============================================
  // 上下文构建
  // ============================================

  /**
   * 构建注入 prompt 的记忆上下文
   */
  async buildMemoryContext(
    options: MemoryContextOptions = {}
  ): Promise<string> {
    const { maxTokens = 4000, includeTypes, topicKeywords } = options;
    const memories: MemoryEntry[] = [];

    const types = includeTypes || (Object.keys(MEMORY_TYPE_PATHS) as MemoryType[]);

    for (const type of types) {
      const recent = await this.getRecentMemories({ count: 30, type });
      memories.push(...recent);
    }

    const scored = this.scoreMemories(memories, topicKeywords);
    const selected = this.selectMemoriesByTokenBudget(scored, maxTokens);

    if (selected.length === 0) {
      return '';
    }

    return this.formatMemoryContext(selected);
  }

  /**
   * 对记忆进行评分
   */
  private scoreMemories(
    memories: MemoryEntry[],
    keywords?: string[]
  ): Array<MemoryEntry & { score: number }> {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    return memories.map((m) => {
      let score = m.importance;

      const age = now - new Date(m.timestamp).getTime();
      if (age < dayMs) {
        score *= 1.0;
      } else if (age < 7 * dayMs) {
        score *= 0.6;
      } else {
        score *= 0.3;
      }

      if (keywords) {
        const text = `${m.content} ${m.summary} ${m.tags.join(' ')}`;
        const matched = keywords.filter((k) =>
          text.toLowerCase().includes(k.toLowerCase())
        ).length;
        score *= 1 + matched * 0.2;
      }

      return { ...m, score };
    });
  }

  /**
   * 按 token 预算选择记忆
   * 使用更保守的估算：2.5 chars/token (考虑中文和格式开销)
   */
  private selectMemoriesByTokenBudget(
    memories: Array<MemoryEntry & { score: number }>,
    maxTokens: number
  ): MemoryEntry[] {
    // 使用更保守的估算，考虑中文和多级 markdown 格式
    const maxChars = maxTokens * 2.5;
    const selected: Array<MemoryEntry & { score: number }> = [];

    // 按分数降序排列
    const sorted = [...memories].sort((a, b) => b.score - a.score);

    for (const m of sorted) {
      // 计算实际开销：content + summary + tags + 格式开销
      const tagsLen = m.tags.join(' ').length;
      const overhead = 30; // markdown 格式开销（标题、分隔符等）
      const entryLen = m.content.length + m.summary.length + tagsLen + overhead;

      if (selected.reduce((sum, e) => sum + e.content.length + e.summary.length + 30, 0) + entryLen <= maxChars) {
        selected.push(m);
      }
    }

    return selected;
  }

  /**
   * 格式化记忆为可注入的文本
   */
  private formatMemoryContext(memories: MemoryEntry[]): string {
    const sections: string[] = ['## 相关记忆'];

    const byType = this.groupByType(memories);
    for (const [type, entries] of Object.entries(byType)) {
      sections.push(`### ${this.getTypeLabel(type as MemoryType)}`);
      for (const m of entries.slice(0, 5)) {
        sections.push(
          `- [${m.timestamp}] ${m.summary}\n  ${m.content.substring(0, 200)}`
        );
      }
    }

    return sections.join('\n');
  }

  private groupByType(
    memories: MemoryEntry[]
  ): Record<MemoryType, MemoryEntry[]> {
    const groups: Record<MemoryType, MemoryEntry[]> = {
      profile: [],
      knowledge: [],
      interaction: [],
      observation: [],
    };

    for (const m of memories) {
      groups[m.type]?.push(m);
    }

    return groups;
  }

  private getTypeLabel(type: MemoryType): string {
    const labels: Record<MemoryType, string> = {
      profile: '用户画像',
      knowledge: '知识积累',
      interaction: '交互历史',
      observation: '观察记录',
    };
    return labels[type];
  }

  // ============================================
  // 辅助方法
  // ============================================

  private getMemoryPath(type: MemoryType, id: string): string {
    return join(this.getBasePath(MEMORY_TYPE_PATHS[type]), `${toSafeFilename(id)}.md`);
  }

  private async ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  private formatEntry(entry: MemoryEntry): string {
    return formatMemoryToMarkdown(entry);
  }

  private parseMemoryFromMarkdown(
    content: string,
    id: string,
    type: MemoryType
  ): MemoryEntry {
    const parsed = parseMemoryFrontmatter(content);
    return { id, type, ...parsed };
  }

  /**
   * 保存后索引更新钩子（三写：Markdown 已写 → INDEX.md → .index.json）
   *
   * Markdown 是真相源（saveMemory 已写），INDEX.md 人类可读（既有），.index.json
   * 查询索引（新增）。三者通过此钩子同步，崩溃后由启动 rebuildIndexFromMarkdown 自愈。
   */
  private async updateIndexAfterSave(entry: MemoryEntry): Promise<void> {
    const index = await this.readIndex();

    index.totalMemories++;
    index.typeStats[entry.type] = (index.typeStats[entry.type] || 0) + 1;

    index.recentMemories = [entry.id, ...index.recentMemories].slice(0, 50);

    if (entry.importance > 0.7) {
      index.importantMemories = [
        entry.id,
        ...index.importantMemories.filter((id) => id !== entry.id),
      ].slice(0, 20);
    }

    const newTags = entry.tags.filter((t) => !index.tags.includes(t));
    index.tags = [...index.tags, ...newTags].slice(0, 100);

    index.lastUpdated = new Date().toISOString();
    await this.writeIndex(index);

    // 三写第三写：JSON 索引 upsert + 一次性 persist
    await this.jsonIndex.upsert(entry);
    await this.jsonIndex.persist();
  }
}

/**
 * 默认记忆存储实例
 */
let defaultStore: MemoryStore | null = null;

export function getMemoryStore(): MemoryStore {
  if (!defaultStore) {
    defaultStore = new MemoryStore();
  }
  return defaultStore;
}
