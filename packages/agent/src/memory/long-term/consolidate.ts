/**
 * 记忆容量管理模块（MEM-02）
 *
 * 负责：
 * - 文件大小检查
 * - 低价值记忆合并（D-01 非破坏：合并走 store.saveMemory + 软删除）
 * - 过期记忆清理（D-01 软删除：archiveFile 移到 .archive/，不直接 rm）
 *
 * 改造要点（01-02）：
 * - **D-01 非破坏性**：所有 `rm` 改为 `archiveFile`；`mergeTopicMemories` 合并记忆走
 *   `store.saveMemory`（双写 INDEX.md + .index.json），不再 writeFile 绕过索引。
 * - **D-03 阈值外置**：`lowImportanceThreshold` / `mergeMaxAgeDays` / `expiryDays`
 *   从 `data/agent-config.json` 的 `consolidation` 段读取，不硬编码。
 * - **D-04 双记**：每次 cleanup 产 INFO 日志 + 一条 observation 记忆（tags 含
 *   'consolidation'），禁止静默数据丢失。
 * - **D-09 显式报错**：`mergeTopicMemories` 在 store 缺失时抛 Error（不静默跳过）。
 */

import { readdir, stat, readFile } from 'fs/promises';
import { join, basename } from 'path';
import { existsSync } from 'fs';
import { consola } from '../../logger.js';
import { config } from '../../config.js';

import {
  DEFAULT_MEMORY_CONFIG,
  defaultMemoryBasePath,
  MEMORY_TYPE_PATHS,
  parseMemoryFrontmatter,
  type MemoryType,
  type MemoryEntry,
} from './types.js';
import type { MemoryStore } from './index.js';
import { archiveFile } from './archive.js';

const logger = consola.withTag('MemoryConsolidation');

/** 一天的毫秒数（统一阈值换算，避免散落魔法值） */
const DAY_MS = 24 * 60 * 60 * 1000;

/** D-04 consolidation observation 记忆的重要度（非阈值，是记录常量） */
const CONSOLIDATION_OBSERVATION_IMPORTANCE = 0.3;

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

  constructor(basePath: string = defaultMemoryBasePath(), store?: MemoryStore) {
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
   * 软删除归档 + 索引联动（CR-02）
   *
   * archiveFile 把 Markdown 移到 .archive/ 后，须同步剔除 INDEX.md / .index.json
   * 中的记录，否则留孤儿记录 → getRecentMemories 读已归档文件静默丢结果。
   * store 未注入时仅归档不联动（与 mergeTopicMemories 的 D-09 抛错路径不冲突）。
   */
  private async archiveAndUnindex(filepath: string, type: MemoryType): Promise<void> {
    await archiveFile(filepath, type, this.basePath);
    if (!this.store) return;
    const id = basename(filepath).replace(/\.md$/, '');
    await this.store.unlinkFromIndex(type, id);
  }

  /**
   * 合并旧记忆（D-03 阈值外置；D-01 软删除；D-04 双记）
   *
   * 阈值优先级：options 显式 > config.consolidation > 保守默认
   */
  async consolidateOldMemories(options: {
    type?: MemoryType;
    maxAgeDays?: number;
    minImportance?: number;
  } = {}): Promise<number> {
    const lowImportanceThreshold =
      options.minImportance ?? config.consolidation?.lowImportanceThreshold ?? 0.2;
    const maxAgeDays =
      options.maxAgeDays ?? config.consolidation?.mergeMaxAgeDays ?? 7;
    const maxAgeMs = maxAgeDays * DAY_MS;

    const { type } = options;
    const types = type ? [type] : (Object.keys(MEMORY_TYPE_PATHS) as MemoryType[]);
    const cutoff = Date.now() - maxAgeMs;
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
            entry.importance < lowImportanceThreshold
          ) {
            // D-01：软删除（归档）+ CR-02 索引联动，不再直接 rm
            await this.archiveAndUnindex(filepath, t);
            deletedCount++;
            deletedByType[t] = (deletedByType[t] || 0) + 1;
            logger.debug('归档低价值旧记忆', {
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
      // D-04：INFO 日志 + observation 记忆双记
      logger.info('清理了低价值旧记忆', {
        count: deletedCount,
        byType: deletedByType,
        threshold: { lowImportanceThreshold, maxAgeDays },
      });
      await this.recordConsolidationObservation(
        `清理了 ${deletedCount} 条低价值旧记忆（importance<${lowImportanceThreshold}，age>${maxAgeDays}d）`,
      );
    }

    return deletedCount;
  }

  /**
   * 合并同一话题的记忆（D-01 走 store 双写 + 软删除；D-09 store 缺失抛错；D-04 双记）
   *
   * @throws Error 当 store 未注入（索引双写依赖 store.saveMemory）
   */
  async mergeTopicMemories(topic: string): Promise<void> {
    // D-09：store 缺失直接抛错（索引双写依赖，不兜底静默跳过）
    if (!this.store) {
      throw new Error(
        'mergeTopicMemories 需要 MemoryStore 实例（合并记忆须走 store.saveMemory 双写索引）',
      );
    }

    const dir = join(this.basePath, MEMORY_TYPE_PATHS.knowledge);
    if (!existsSync(dir)) return;

    const topicLower = topic.toLowerCase();
    const files = await readdir(dir);

    const entries: MemoryEntry[] = [];
    const matchedFiles: string[] = [];

    // WR-10：按 tags/summary/content 匹配话题（旧版按文件名子串匹配，saveMemory 生成的
    // id 不含 topic，生产环境零命中；且子串匹配会误并——如 topic=cat 命中 category）。
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const filepath = join(dir, file);
      const content = await readFile(filepath, 'utf-8');
      const parsed = parseMemoryFrontmatter(content);
      const tagHit = parsed.tags.some((t) => t.toLowerCase() === topicLower);
      const textHit =
        `${parsed.summary} ${parsed.content}`.toLowerCase().includes(topicLower);
      if (!tagHit && !textHit) continue;
      entries.push({
        id: file.replace(/\.md$/, ''),
        type: 'knowledge',
        ...parsed,
      });
      matchedFiles.push(file);
    }

    if (entries.length < 2) return;

    const mergedId = `knowledge-${topicLower}-merged`;
    const merged: MemoryEntry = {
      id: mergedId,
      type: 'knowledge',
      timestamp: new Date().toISOString(),
      tags: [...new Set(entries.flatMap((e) => e.tags))],
      summary: `关于 ${topic} 的知识汇总 (${entries.length} 条)`,
      content: entries.map((e) => `### ${e.summary}\n\n${e.content}`).join('\n\n---\n\n'),
      importance: Math.max(...entries.map((e) => e.importance)),
    };

    // D-01：合并记忆走 store.saveMemory（双写 INDEX.md + .index.json），不再 writeFile 绕索引
    await this.store.saveMemory(merged);

    // D-01：旧文件软删除（归档到 .archive/knowledge/）+ CR-02 索引联动，不再直接 rm
    for (const file of matchedFiles) {
      await this.archiveAndUnindex(join(dir, file), 'knowledge');
    }

    // D-04：INFO 日志 + observation 记忆双记
    logger.info('记忆合并完成', { topic, count: entries.length, mergedId });
    await this.recordConsolidationObservation(
      `合并话题 ${topic}：${entries.length} 条记忆合并为 ${mergedId}`,
    );
  }

  /**
   * 清理过期记忆（D-03 expiryDays 阈值外置；D-01 软删除；D-04 双记）
   *
   * accessedAt 优先读 JSON 索引（accessedAt 已迁索引，01-01）；
   * 索引缺失时回退 Markdown frontmatter（Pitfall 4 兼容旧文件）。
   */
  async cleanupExpired(): Promise<number> {
    const expiryDays = config.consolidation?.expiryDays ?? 60;
    const cutoff = Date.now() - expiryDays * DAY_MS;
    let deletedCount = 0;
    const deletedByType: Record<string, number> = {};

    for (const type of Object.keys(MEMORY_TYPE_PATHS) as MemoryType[]) {
      const dir = join(this.basePath, MEMORY_TYPE_PATHS[type]);
      if (!existsSync(dir)) continue;

      const files = await readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const filepath = join(dir, file);
        const id = file.replace('.md', '');

        try {
          const content = await readFile(filepath, 'utf-8');
          const parsed = parseMemoryFrontmatter(content);

          // accessedAt 优先读索引（01-01 已迁）；索引无回退 frontmatter 再回退 timestamp
          let accessedAt: string | null = null;
          if (this.store) {
            const indexed = await this.store.getMemoryAccessedAt(type, id);
            accessedAt = indexed;
          }
          if (!accessedAt) {
            accessedAt = extractAccessedAt(content) || parsed.timestamp;
          }

          if (new Date(accessedAt).getTime() < cutoff) {
            // D-01：软删除（归档）+ CR-02 索引联动，不再直接 rm
            await this.archiveAndUnindex(filepath, type);
            deletedCount++;
            deletedByType[type] = (deletedByType[type] || 0) + 1;
          }
        } catch (error) {
          logger.warn('清理过期记忆失败', { file, error });
        }
      }
    }

    if (deletedCount > 0) {
      // D-04：INFO 日志 + observation 记忆双记
      logger.info('清理了过期记忆', {
        count: deletedCount,
        byType: deletedByType,
        expiryDays,
      });
      await this.recordConsolidationObservation(
        `清理了 ${deletedCount} 条过期记忆（accessedAt > ${expiryDays}d 未访问）`,
      );
    }

    return deletedCount;
  }

  /**
   * D-04 双记：记一条 observation 记忆（tags 含 'consolidation'）
   *
   * store 缺失时仅记日志（不抛错——cleanup 已成功，双记是增强可观测性而非硬性约束）。
   */
  private async recordConsolidationObservation(message: string): Promise<void> {
    if (!this.store) {
      logger.warn('无法记录 consolidation observation（store 未注入）', { message });
      return;
    }
    try {
      await this.store.saveMemory({
        type: 'observation',
        timestamp: new Date().toISOString(),
        tags: ['consolidation'],
        summary: '记忆合并/清理',
        content: message,
        importance: CONSOLIDATION_OBSERVATION_IMPORTANCE,
      });
    } catch (error) {
      // 双记失败不阻断 cleanup 主流程（数据已软删除，仅可观测性损失）
      logger.error('记录 consolidation observation 失败', { message, error });
    }
  }
}

let defaultConsolidator: MemoryConsolidator | null = null;

export function getMemoryConsolidator(store?: MemoryStore): MemoryConsolidator {
  if (!defaultConsolidator) {
    defaultConsolidator = new MemoryConsolidator(
      defaultMemoryBasePath(),
      store,
    );
  }
  return defaultConsolidator;
}
