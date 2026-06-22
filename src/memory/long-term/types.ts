/**
 * 长期记忆类型定义
 */

import { createHash } from 'crypto';
import { z } from 'zod';

/** 记忆类型枚举 */
export type MemoryType = 'profile' | 'knowledge' | 'interaction' | 'observation';

/** 记忆条目 */
export interface MemoryEntry {
  id: string;
  type: MemoryType;
  timestamp: string;
  tags: string[];
  summary: string;
  content: string;
  importance: number;
  accessedAt?: string;
}

/** 记忆索引 */
export interface MemoryIndex {
  lastUpdated: string;
  totalMemories: number;
  typeStats: Record<MemoryType, number>;
  recentMemories: string[];
  importantMemories: string[];
  tags: string[];
}

/** 上下文注入选项 */
export interface MemoryContextOptions {
  maxTokens?: number;
  includeTypes?: MemoryType[];
  topicKeywords?: string[];
  timeRange?: {
    start?: string;
    end?: string;
  };
}

/** 记忆合并/清理阈值（D-03 外置到 agent-config.json；默认值由 config.ts defaultBehavior 提供） */
export interface MemoryConsolidationConfig {
  lowImportanceThreshold: number;
  expiryDays: number;
  mergeMaxAgeDays: number;
  urlCleanupDays: number;
}

/** 记忆存储配置 */
export interface MemoryConfig {
  basePath: string;
  maxFileSize: number;
  maxTotalSize: number;
  maxAge: number;
  consolidationThreshold: number;
  /** D-03 合并/清理阈值；本字段本期不在 DEFAULT_MEMORY_CONFIG 设默认（由 config.ts defaultBehavior 提供，避免双源） */
  consolidation?: MemoryConsolidationConfig;
  /** D-10 generateText 重试次数；同上不在 DEFAULT_MEMORY_CONFIG 设默认 */
  generateTextMaxRetries?: number;
}

/** 默认配置 */
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  basePath: 'data/memory',
  maxFileSize: 10 * 1024,
  maxTotalSize: 5 * 1024 * 1024,
  maxAge: 30 * 24 * 60 * 60 * 1000,
  consolidationThreshold: 50,
};

/** 记忆类型路径映射 */
export const MEMORY_TYPE_PATHS: Record<MemoryType, string> = {
  profile: 'profile',
  knowledge: 'knowledge',
  interaction: 'interactions',
  observation: 'observations',
};

/** 文件名有效字符的正则 */
const SAFE_FILENAME_REGEX = /[^a-zA-Z0-9一-龥_-]/g;

/**
 * 生成安全的文件名
 * 防止路径遍历攻击 (../) 和路径分隔符
 */
export function toSafeFilename(str: string): string {
  // 阻止路径遍历和多级目录
  const sanitized = str
    .replace(/\.\./g, '-')           // 阻止 .. 路径遍历
    .replace(/[\/\\]/g, '-')          // 阻止路径分隔符
    .replace(SAFE_FILENAME_REGEX, '-') // 替换其他非法字符
    .replace(/-+/g, '-')              // 折叠多个连字符
    .replace(/^-|-$/g, '');           // 去除首尾连字符

  // 防止空文件名
  if (!sanitized) {
    return `mem-${Date.now()}`;
  }

  return sanitized.substring(0, 50);
}

/**
 * 生成记忆 ID
 * 使用 sha256 hash 避免碰撞
 */
export function generateMemoryId(type: MemoryType, content: string): string {
  const timestamp = Date.now();
  const hash = createHash('sha256').update(content).digest('hex').substring(0, 16);
  return `${type}-${timestamp}-${hash}`;
}

/**
 * 将记忆条目格式化为 Markdown（供 MemoryStore 和 MemoryConsolidator 共享）
 */
export function formatMemoryToMarkdown(entry: MemoryEntry): string {
  const lines = [
    '---',
    `id: ${entry.id}`,
    `type: ${entry.type}`,
    `timestamp: ${entry.timestamp}`,
    `tags: ${entry.tags.join(', ')}`,
    `importance: ${entry.importance}`,
  ];
  if (entry.accessedAt) {
    lines.push(`accessedAt: ${entry.accessedAt}`);
  }
  lines.push('---', '', `## ${entry.summary}`, '', entry.content);

  return lines.join('\n');
}

/** 解析记忆文件的 frontmatter（供 MemoryStore 和 MemoryConsolidator 共享） */
export function parseMemoryFrontmatter(content: string): {
  timestamp: string;
  tags: string[];
  importance: number;
  summary: string;
  content: string;
} {
  // D-09：合法记忆必须有 --- frontmatter 分界。缺分界视为非法内容，抛错（不兜底）
  if (!content.startsWith('---') || content.split('---').length < 3) {
    throw new Error('非法记忆内容：缺少 frontmatter 分界（---）');
  }

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

// ============================================
// JSON sidecar 索引 schema（MEM-01）
// ============================================

/**
 * 单条记忆的索引记录
 *
 * 仅含检索/排序所需字段（不含 content），用于 .index.json sidecar。
 * `filepath` 为相对 basePath 的 Markdown 路径（如 `knowledge/knowledge-xxx.md`）。
 */
export interface MemoryIndexRecord {
  id: string;
  type: MemoryType;
  timestamp: string;
  accessedAt: string;
  importance: number;
  tags: string[];
  summary: string;
  filepath: string;
}

/**
 * JSON sidecar 索引顶层结构
 *
 * `version: 1` 为字面量（防 schema 漂移，Pitfall 5）；读取时若版本缺失/不匹配触发 rebuild。
 */
export interface MemoryJsonIndex {
  version: 1;
  lastUpdated: string;
  records: MemoryIndexRecord[];
}

/** Zod schema：单条索引记录（供 loadJsonIndex 校验防脏数据，RESEARCH V5） */
export const MemoryIndexRecordSchema = z.object({
  id: z.string(),
  type: z.enum(['profile', 'knowledge', 'interaction', 'observation']),
  timestamp: z.string(),
  accessedAt: z.string(),
  importance: z.number(),
  tags: z.array(z.string()),
  summary: z.string(),
  filepath: z.string(),
});

/** Zod schema：JSON sidecar 索引顶层 */
export const MemoryJsonIndexSchema = z.object({
  version: z.literal(1),
  lastUpdated: z.string(),
  records: z.array(MemoryIndexRecordSchema),
});
