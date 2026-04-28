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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = consola.withTag('MemoryStore');

/**
 * 长期记忆存储管理器
 */
export class MemoryStore {
  private config: MemoryConfig;
  private indexCache: MemoryIndex | null = null;

  constructor(config: Partial<MemoryConfig> = {}) {
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
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
   * 读取记忆索引
   */
  async readIndex(): Promise<MemoryIndex> {
    const indexPath = this.getBasePath('INDEX.md');

    if (!existsSync(indexPath)) {
      return this.createDefaultIndex();
    }

    try {
      const content = await readFile(indexPath, 'utf-8');
      return this.parseIndexFromMarkdown(content);
    } catch (error) {
      logger.error('读取索引失败，使用默认索引', { error });
      return this.createDefaultIndex();
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
      `- 总记忆数: ${index.totalMemories}`,
      `- 类型统计: ${JSON.stringify(index.typeStats)}`,
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
    } catch {
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
   */
  async getMemory(type: MemoryType, id: string): Promise<MemoryEntry | null> {
    const filepath = this.getMemoryPath(type, id);

    if (!existsSync(filepath)) {
      return null;
    }

    try {
      const content = await readFile(filepath, 'utf-8');
      const entry = this.parseMemoryFromMarkdown(content, id, type);
      entry.accessedAt = new Date().toISOString();

      const updatedContent = this.formatEntry(entry);
      await writeFile(filepath, updatedContent, 'utf-8');

      return entry;
    } catch (error) {
      logger.error('读取记忆失败', { id, error });
      return null;
    }
  }

  /**
   * 获取最近记忆
   */
  async getRecentMemories(options: {
    count?: number;
    type?: MemoryType;
    since?: string;
  } = {}): Promise<MemoryEntry[]> {
    const { count = 20, type, since } = options;
    const memories: MemoryEntry[] = [];

    const types = type ? [type] : (Object.keys(MEMORY_TYPE_PATHS) as MemoryType[]);

    for (const t of types) {
      const dir = this.getBasePath(MEMORY_TYPE_PATHS[t]);
      if (!existsSync(dir)) continue;

      const files = await readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const entry = await this.getMemory(t, file.replace('.md', ''));
        if (entry) {
          if (since && entry.timestamp < since) continue;
          memories.push(entry);
        }
      }
    }

    return memories
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, count);
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
   * 删除记忆
   */
  async deleteMemory(type: MemoryType, id: string): Promise<boolean> {
    const filepath = this.getMemoryPath(type, id);

    if (!existsSync(filepath)) {
      return false;
    }

    try {
      await rm(filepath);
      logger.debug('记忆已删除', { id });

      const index = await this.readIndex();
      index.totalMemories = Math.max(0, index.totalMemories - 1);
      index.typeStats[type] = Math.max(0, (index.typeStats[type] || 1) - 1);
      index.recentMemories = index.recentMemories.filter((memId) => memId !== id);
      index.importantMemories = index.importantMemories.filter((memId) => memId !== id);
      await this.writeIndex(index);

      return true;
    } catch (error) {
      logger.error('删除记忆失败', { id, error });
      return false;
    }
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
