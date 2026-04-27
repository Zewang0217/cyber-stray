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
 * 使用更长的 hash 降低碰撞风险
 */
export function generateMemoryId(type: MemoryType, content: string): string {
  const timestamp = Date.now();
  const hash = content
    .substring(0, 32)                            // 增加 hash 长度到 32
    .replace(SAFE_FILENAME_REGEX, '')
    .substring(0, 32);
  return `${type}-${timestamp}-${hash}`;
}
