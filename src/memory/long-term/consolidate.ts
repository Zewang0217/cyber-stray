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

import { DEFAULT_MEMORY_CONFIG, MEMORY_TYPE_PATHS, type MemoryType } from './types.js';

const logger = consola.withTag('MemoryConsolidation');

/**
 * 容量管理器
 */
export class MemoryConsolidator {
  private config = DEFAULT_MEMORY_CONFIG;
  private basePath: string;

  constructor(basePath: string = DEFAULT_MEMORY_CONFIG.basePath) {
    this.basePath = basePath;
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

    for (const t of types) {
      const dir = join(this.basePath, MEMORY_TYPE_PATHS[t]);
      if (!existsSync(dir)) continue;

      const files = await readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const filepath = join(dir, file);

        try {
          const content = await readFile(filepath, 'utf-8');
          const entry = this.parseMemoryFile(content, file.replace('.md', ''));

          if (
            new Date(entry.timestamp).getTime() < cutoff &&
            entry.importance < minImportance
          ) {
            await rm(filepath);
            deletedCount++;
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
    }

    return deletedCount;
  }

  /**
   * 合并同一话题的记忆
   */
  async mergeTopicMemories(topic: string): Promise<void> {
    const dir = join(this.basePath, MEMORY_TYPE_PATHS.knowledge);
    if (!existsSync(dir)) return;

    const topicLower = topic.toLowerCase().replace(/[^a-z0-9一-龥]/g, '-');
    const files = await readdir(dir);

    const topicFiles = files.filter(
      (f) => f.includes(topicLower) && f.endsWith('.md')
    );

    if (topicFiles.length < 2) return;

    const entries = [];
    for (const file of topicFiles) {
      const filepath = join(dir, file);
      const content = await readFile(filepath, 'utf-8');
      entries.push(this.parseMemoryFile(content, file.replace('.md', '')));
    }

    const merged: Record<string, unknown> = {
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
      this.formatMemoryToMarkdown(merged),
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

    for (const type of Object.keys(MEMORY_TYPE_PATHS) as MemoryType[]) {
      const dir = join(this.basePath, MEMORY_TYPE_PATHS[type]);
      if (!existsSync(dir)) continue;

      const files = await readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const filepath = join(dir, file);

        try {
          const fileStat = await stat(filepath);
          if (fileStat.atimeMs < cutoff) {
            await rm(filepath);
            deletedCount++;
          }
        } catch (error) {
          logger.warn('清理过期记忆失败', { file, error });
        }
      }
    }

    if (deletedCount > 0) {
      logger.info(`清理了 ${deletedCount} 条过期记忆`);
    }

    return deletedCount;
  }

  private parseMemoryFile(content: string, id: string): {
    timestamp: string;
    tags: string[];
    importance: number;
    summary: string;
    content: string;
  } {
    const parts = content.split('---');
    const metaStr = parts[1] || '';
    const body = parts[2] || '';

    const meta: Record<string, string> = {};
    for (const line of metaStr.split('\n')) {
      const match = line.match(/^\s*(\w+):\s*(.+)$/);
      if (match && match[1]) {
        meta[match[1]] = match[2] || '';
      }
    }

    const summaryMatch = body.match(/^##\s*(.+)$/m);
    const summary = summaryMatch?.[1] || '';

    return {
      timestamp: meta.timestamp || new Date().toISOString(),
      tags: meta.tags ? meta.tags.split(', ').filter(Boolean) : [],
      importance: parseFloat(meta.importance || '0.5'),
      summary,
      content: body.replace(/^##\s*.+\n/, '').trim(),
    };
  }

  private formatMemoryToMarkdown(entry: Record<string, unknown>): string {
    const lines = [
      '---',
      `id: ${entry.id}`,
      `type: ${entry.type}`,
      `timestamp: ${entry.timestamp}`,
      `tags: ${(entry.tags as string[]).join(', ')}`,
      `importance: ${entry.importance}`,
      '---',
      '',
      `## ${entry.summary}`,
      '',
      entry.content as string,
    ];

    return lines.join('\n');
  }
}

let defaultConsolidator: MemoryConsolidator | null = null;

export function getMemoryConsolidator(): MemoryConsolidator {
  if (!defaultConsolidator) {
    defaultConsolidator = new MemoryConsolidator();
  }
  return defaultConsolidator;
}
