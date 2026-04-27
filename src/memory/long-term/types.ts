/**
 * 长期记忆类型定义
 */

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

/** 记忆存储配置 */
export interface MemoryConfig {
  basePath: string;
  maxFileSize: number;
  maxTotalSize: number;
  maxAge: number;
  consolidationThreshold: number;
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
 */
export function toSafeFilename(str: string): string {
  return str.replace(SAFE_FILENAME_REGEX, '-').substring(0, 50);
}

/**
 * 生成记忆 ID
 */
export function generateMemoryId(type: MemoryType, content: string): string {
  const timestamp = Date.now();
  const hash = content.substring(0, 20).replace(SAFE_FILENAME_REGEX, '');
  return `${type}-${timestamp}-${hash}`;
}
