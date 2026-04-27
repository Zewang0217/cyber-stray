/**
 * 记忆写入模块
 *
 * 提供高级写入接口，支持：
 * - 交互记录自动保存
 * - 用户反馈记录
 * - 知识积累
 */

import { getMemoryStore } from './index.js';
import type { MemoryType, MemoryEntry } from './types.js';

const store = getMemoryStore();

/**
 * 记录一次交互
 */
export async function recordInteraction(params: {
  action: string;
  content: string;
  result?: string;
  tags?: string[];
}): Promise<MemoryEntry> {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  return store.saveMemory({
    type: 'interaction',
    timestamp: now.toISOString(),
    tags: ['daily', `date:${dateStr}`, ...(params.tags || [])],
    summary: `${params.action}: ${params.content.substring(0, 50)}`,
    content: `${params.action}\n\n${params.content}\n\n结果: ${params.result || '成功'}`,
    importance: 0.5,
  });
}

/**
 * 记录用户反馈
 */
export async function recordFeedback(params: {
  type: 'like' | 'dislike';
  topic: string;
  content?: string;
}): Promise<MemoryEntry> {
  const now = new Date();

  return store.saveMemory({
    type: 'observation',
    timestamp: now.toISOString(),
    tags: ['feedback', params.type],
    summary: `用户${params.type === 'like' ? '喜欢' : '不喜欢'}: ${params.topic}`,
    content: `用户对 "${params.topic}" 表达了${params.type === 'like' ? '喜欢' : '不喜欢'}${
      params.content ? `\n\n原始内容: ${params.content}` : ''
    }`,
    importance: params.type === 'like' ? 0.6 : 0.4,
  });
}

/**
 * 记录发现的知识
 */
export async function recordKnowledge(params: {
  topic: string;
  title: string;
  content: string;
  source?: string;
  url?: string;
}): Promise<MemoryEntry> {
  const now = new Date();

  return store.saveMemory({
    type: 'knowledge',
    timestamp: now.toISOString(),
    tags: ['knowledge', toSafeTag(params.topic)],
    summary: params.title,
    content: `${params.title}\n\n${params.content}${
      params.source ? `\n\n来源: ${params.source}` : ''
    }${params.url ? `\n链接: ${params.url}` : ''}`,
    importance: 0.5,
  });
}

/**
 * 记录观察洞察
 */
export async function recordObservation(params: {
  title: string;
  content: string;
  tags?: string[];
}): Promise<MemoryEntry> {
  const now = new Date();

  return store.saveMemory({
    type: 'observation',
    timestamp: now.toISOString(),
    tags: ['observation', ...(params.tags || [])],
    summary: params.title,
    content: params.content,
    importance: 0.6,
  });
}

/**
 * 更新用户偏好
 */
export async function updateUserPreference(params: {
  key: string;
  value: string;
  type: 'like' | 'dislike' | 'neutral';
}): Promise<void> {
  const content = params.type === 'like'
    ? `用户喜欢: ${params.value}`
    : params.type === 'dislike'
    ? `用户不喜欢: ${params.value}`
    : `用户偏好: ${params.key} = ${params.value}`;

  await store.saveMemory({
    type: 'profile',
    timestamp: new Date().toISOString(),
    tags: ['preference', params.type, toSafeTag(params.key)],
    summary: `偏好更新: ${params.key}`,
    content,
    importance: 0.8,
  });
}

function toSafeTag(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9一-龥]/g, '-').substring(0, 20);
}

function extractDomains(urls: string[]): string[] {
  return urls
    .map((url) => {
      try {
        return new URL(url).hostname;
      } catch {
        return toSafeTag(url);
      }
    })
    .filter(Boolean);
}

/**
 * 记录一次游荡总结
 */
export async function recordWanderSummary(params: {
  steps: number;
  topics: string[];
  spoke: string;
  duration?: number;
}): Promise<MemoryEntry> {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  const spokeSummary = params.spoke.length > 30
    ? `${params.spoke.substring(0, 30)}...`
    : params.spoke;

  return store.saveMemory({
    type: 'interaction',
    timestamp: now.toISOString(),
    tags: ['wander', `date:${dateStr}`, ...extractDomains(params.topics)],
    summary: `游荡 ${params.steps} 步，分享: ${spokeSummary}`,
    content: `本次游荡共 ${params.steps} 步${params.duration ? `，耗时 ${params.duration}ms` : ''}\n\n探索话题: ${params.topics.join(', ')}\n\n分享内容: ${params.spoke}`,
    importance: 0.6,
  });
}
