/**
 * 记忆容量管理模块
 *
 * 负责：
 * - 文件大小检查
 * - 低价值记忆合并
 * - 过期记忆清理
 */

import { readdir, stat, readFile, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { consola } from '../../logger.js';

import {
  DEFAULT_MEMORY_CONFIG,
  MEMORY_TYPE_PATHS,
  toSafeFilename,
  parseMemoryFrontmatter,
  formatMemoryToMarkdown,
  type MemoryType,
  type MemoryEntry,
} from './types.js';
import type { MemoryStore } from './index.js';

const logger = consola.withTag('MemoryConsolidation');

function extractAccessedAt(content: string): string | null {
  const parts = content.split('---');
  const metaStr = parts[1] || '';
  const match = metaStr.match(/accessedAt:\s*(.+)/);
  return match?.[1]?.trim() || null;
}

/**
 * 容量管理器
 */
export class MemoryConsolidator {
  private config = DEFAULT_MEMORY_CONFIG;
  private basePath: string;
  private store?: MemoryStore;

  constructor(basePath: string = DEFAULT_MEMORY_CONFIG.basePath, store?: MemoryStore) {
    this.basePath = basePath;
    this.store = store;
  }

  /**
   * 检查是否需要压缩
   */
  async needsConsolidation(): Promise<boolean> {
    const totalSize = await this.getTotalSize();
    return totalSize > this.config.maxTotalSize;
  }

  /**
   * 获取总存储大小
   */
  async getTotalSize(): Promise<number> {
    let total = 0;

    for (const type of Object.keys(MEMORY_TYPE_PATHS) as MemoryType[]) {
      const dir = join(this.basePath, MEMORY_TYPE_PATHS[type]);
      if (!existsSync(dir)) continue;

      const files = await readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const filepath = join(dir, file);
        const fileStat = await stat(filepath);
        total += fileStat.size;
      }
    }

    return total;
  }

  /**
   * 获取各类型的文件数量
   */
  async getFileCounts(): Promise<Record<MemoryType, number>> {
    const counts: Record<MemoryType, number> = {
      profile: 0,
      knowledge: 0,
      interaction: 0,
      observation: 0,
    };

    for (const type of Object.keys(MEMORY_TYPE_PATHS) as MemoryType[]) {
      const dir = join(this.basePath, MEMORY_TYPE_PATHS[type]);
      if (!existsSync(dir)) continue;

      const files = await readdir(dir);
      counts[type] = files.filter((f) => f.endsWith('.md')).length;
    }

    return counts;
  }

  /**
   * 合并旧记忆
   */
  async consolidateOldMemories(options: {
    type?: MemoryType;
    maxAge?: number;
    minImportance?: number;
  } = {}): Promise<number> {
    const { type, maxAge = 7 * 24 * 60 * 60 * 1000, minImportance = 0.3 } = options;
    const types = type ? [type] : (Object.keys(MEMORY_TYPE_PATHS) as MemoryType[]);
    const cutoff = Date.now() - maxAge;
    let deletedCount = 0;
    const deletedByType: Record<string, number> = {};

    for (const t of types) {
      const dir = join(this.basePath, MEMORY_TYPE_PATHS[t]);
      if (!existsSync(dir)) continue;

      const files = await readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const filepath = join(dir, file);

        try {
          const content = await readFile(filepath, 'utf-8');
          const entry = parseMemoryFrontmatter(content);

          if (
            new Date(entry.timestamp).getTime() < cutoff &&
            entry.importance < minImportance
          ) {
            await rm(filepath);
            deletedCount++;
            deletedByType[t] = (deletedByType[t] || 0) + 1;
            logger.debug('删除低价值旧记忆', {
              id: file,
              age: entry.timestamp,
              importance: entry.importance,
            });
          }
        } catch (error) {
          logger.warn('处理记忆文件失败', { file, error });
        }
      }
    }

    if (deletedCount > 0) {
      logger.info(`清理了 ${deletedCount} 条低价值旧记忆`);

      if (this.store) {
        const index = await this.store.readIndex();
        index.totalMemories = Math.max(0, index.totalMemories - deletedCount);
        for (const [t, count] of Object.entries(deletedByType)) {
          index.typeStats[t as MemoryType] = Math.max(0, (index.typeStats[t as MemoryType] || count) - count);
        }
        await this.store.writeIndex(index);
      }
    }

    return deletedCount;
  }

  /**
   * 合并同一话题的记忆
   */
  async mergeTopicMemories(topic: string): Promise<void> {
    const dir = join(this.basePath, MEMORY_TYPE_PATHS.knowledge);
    if (!existsSync(dir)) return;

    const topicLower = toSafeFilename(topic).toLowerCase();
    const files = await readdir(dir);

    const topicFiles = files.filter(
      (f) => f.includes(topicLower) && f.endsWith('.md')
    );

    if (topicFiles.length < 2) return;

    const entries = [];
    for (const file of topicFiles) {
      const filepath = join(dir, file);
      const content = await readFile(filepath, 'utf-8');
      const parsed = parseMemoryFrontmatter(content);
      entries.push({
        id: file.replace('.md', ''),
        type: 'knowledge' as const,
        ...parsed,
      });
    }

    const merged: MemoryEntry = {
      id: `knowledge-${topicLower}-merged`,
      type: 'knowledge',
      timestamp: new Date().toISOString(),
      tags: [...new Set(entries.flatMap((e) => e.tags))],
      summary: `关于 ${topic} 的知识汇总 (${entries.length} 条)`,
      content: entries.map((e) => `### ${e.summary}\n\n${e.content}`).join('\n\n---\n\n'),
      importance: Math.max(...entries.map((e) => e.importance)),
    };

    const mergedPath = join(dir, `${topicLower}-merged.md`);
    await writeFile(
      mergedPath,
      formatMemoryToMarkdown(merged),
      'utf-8'
    );

    for (const file of topicFiles) {
      await rm(join(dir, file));
    }

    logger.info('记忆合并完成', { topic, count: entries.length });
  }

  /**
   * 清理过期记忆（30天未访问）
   */
  async cleanupExpired(): Promise<number> {
    const cutoff = Date.now() - this.config.maxAge;
    let deletedCount = 0;
    const deletedByType: Record<string, number> = {};

    for (const type of Object.keys(MEMORY_TYPE_PATHS) as MemoryType[]) {
      const dir = join(this.basePath, MEMORY_TYPE_PATHS[type]);
      if (!existsSync(dir)) continue;

      const files = await readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const filepath = join(dir, file);

        try {
          const content = await readFile(filepath, 'utf-8');
          const parsed = parseMemoryFrontmatter(content);

          const accessedAt = extractAccessedAt(content) || parsed.timestamp;
          if (new Date(accessedAt).getTime() < cutoff) {
            await rm(filepath);
            deletedCount++;
            deletedByType[type] = (deletedByType[type] || 0) + 1;
          }
        } catch (error) {
          logger.warn('清理过期记忆失败', { file, error });
        }
      }
    }

    if (deletedCount > 0) {
      logger.info(`清理了 ${deletedCount} 条过期记忆`);

      if (this.store) {
        const index = await this.store.readIndex();
        index.totalMemories = Math.max(0, index.totalMemories - deletedCount);
        for (const [t, count] of Object.entries(deletedByType)) {
          index.typeStats[t as MemoryType] = Math.max(0, (index.typeStats[t as MemoryType] || count) - count);
        }
        await this.store.writeIndex(index);
      }
    }

    return deletedCount;
  }

}

let defaultConsolidator: MemoryConsolidator | null = null;

export function getMemoryConsolidator(store?: MemoryStore): MemoryConsolidator {
  if (!defaultConsolidator) {
    defaultConsolidator = new MemoryConsolidator(
      DEFAULT_MEMORY_CONFIG.basePath,
      store,
    );
  }
  return defaultConsolidator;
}
