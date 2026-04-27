/**
 * 记忆读取模块
 *
 * 提供高级读取接口，支持：
 * - 按类型查询
 * - 搜索
 * - 上下文构建
 */

import { getMemoryStore } from './index.js';
import type { MemoryType, MemoryEntry, MemoryContextOptions } from './types.js';

const store = getMemoryStore();

/**
 * 获取用户画像记忆
 */
export async function getUserProfile(): Promise<MemoryEntry[]> {
  return store.getRecentMemories({ type: 'profile', count: 20 });
}

/**
 * 获取用户偏好
 */
export async function getUserPreferences(): Promise<{
  likes: string[];
  dislikes: string[];
}> {
  const profiles = await getUserProfile();

  const likes: string[] = [];
  const dislikes: string[] = [];

  for (const p of profiles) {
    if (p.tags.includes('like')) {
      likes.push(p.content.replace('用户喜欢: ', ''));
    } else if (p.tags.includes('dislike')) {
      dislikes.push(p.content.replace('用户不喜欢: ', ''));
    }
  }

  return { likes, dislikes };
}

/**
 * 获取最近交互历史
 */
export async function getRecentInteractions(
  days: number = 7
): Promise<MemoryEntry[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return store.getRecentMemories({ type: 'interaction', since, count: 50 });
}

/**
 * 获取相关话题知识
 */
export async function getTopicKnowledge(
  topic: string,
  count: number = 5
): Promise<MemoryEntry[]> {
  const all = await store.getRecentMemories({ type: 'knowledge', count: 50 });
  const topicLower = topic.toLowerCase();

  return all
    .filter(
      (m) =>
        m.tags.some((t) => t.toLowerCase().includes(topicLower)) ||
        m.content.toLowerCase().includes(topicLower)
    )
    .slice(0, count);
}

/**
 * 获取观察记录
 */
export async function getObservations(
  count: number = 10
): Promise<MemoryEntry[]> {
  return store.getRecentMemories({ type: 'observation', count });
}

/**
 * 搜索记忆
 */
export async function searchMemory(query: string): Promise<MemoryEntry[]> {
  return store.searchMemories(query);
}

/**
 * 构建系统 prompt 用的记忆上下文
 */
export async function buildMemoryPromptContext(
  options: MemoryContextOptions = {}
): Promise<string> {
  const context = await store.buildMemoryContext({
    maxTokens: options.maxTokens || 3000,
    includeTypes: options.includeTypes || ['profile', 'interaction', 'observation'],
    topicKeywords: options.topicKeywords,
  });

  if (!context) {
    return '';
  }

  return `\n\n## 长期记忆上下文\n${context}`;
}

/**
 * 获取记忆统计
 */
export async function getMemoryStats(): Promise<{
  total: number;
  byType: Record<MemoryType, number>;
  recentCount: number;
  importantCount: number;
}> {
  const index = await store.readIndex();
  const recent = await store.getRecentMemories({ count: 100 });
  const important = recent.filter((m) => m.importance >= 0.7);

  return {
    total: index.totalMemories,
    byType: index.typeStats,
    recentCount: recent.length,
    importantCount: important.length,
  };
}

/**
 * 获取今天的交互摘要
 */
export async function getTodaySummary(): Promise<string> {
  const today = new Date().toISOString().split('T')[0];
  const interactions = await store.getRecentMemories({
    type: 'interaction',
    count: 20,
  });

  const todayInteractions = interactions.filter((m) =>
    m.tags.some((t) => t === `date:${today}`)
  );

  if (todayInteractions.length === 0) {
    return '今天还没有交互记录';
  }

  const wanderCount = todayInteractions.filter((m) =>
    m.tags.includes('wander')
  ).length;
  const shareCount = todayInteractions.filter((m) =>
    m.content.includes('分享')
  ).length;

  return `今天已完成 ${wanderCount} 次游荡，分享了 ${shareCount} 条内容`;
}
