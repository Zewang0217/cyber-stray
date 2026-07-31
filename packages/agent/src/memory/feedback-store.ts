/**
 * 飞书反馈存储模块
 *
 * 负责存储和读取用户通过飞书卡片按钮提交的反馈
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { consola } from '../logger.js';
import { getDataPath } from '../config.js';

const logger = consola.withTag('feedback-store');

/** 反馈存储文件（调用时求值，尊重 DATA_DIR，且不随 cwd 漂移） */
function feedbackFilePath(): string {
  return getDataPath('feedback.json');
}

/** 反馈类型 */
export type FeedbackType = 'like' | 'dislike';

/** 单条反馈 */
export interface Feedback {
  id: string;
  type: FeedbackType;
  messageId?: string;   // 飞书消息 ID
  userId?: string;      // 用户 open_id
  timestamp: string;
  status: 'pending' | 'processed';
  agentResponse?: string;
}

/** 反馈存储结构 */
interface FeedbackStore {
  feedbacks: Feedback[];
  lastUpdated: string;
}

/** 反馈统计 */
export interface FeedbackStats {
  total: number;
  pending: number;
  processed: number;
  likes: number;
  dislikes: number;
}

/**
 * 确保反馈文件存在
 */
async function ensureFeedbackFile(): Promise<void> {
  const filePath = feedbackFilePath();
  if (!existsSync(filePath)) {
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const initial: FeedbackStore = { feedbacks: [], lastUpdated: new Date().toISOString() };
    await writeFile(filePath, JSON.stringify(initial, null, 2), 'utf-8');
    logger.info('创建反馈存储文件', { path: filePath });
  }
}

/**
 * 读取反馈存储
 */
async function readStore(): Promise<FeedbackStore> {
  await ensureFeedbackFile();
  const content = await readFile(feedbackFilePath(), 'utf-8');
  return JSON.parse(content) as FeedbackStore;
}

/**
 * 写入反馈存储
 */
async function writeStore(store: FeedbackStore): Promise<void> {
  store.lastUpdated = new Date().toISOString();
  await writeFile(feedbackFilePath(), JSON.stringify(store, null, 2), 'utf-8');
}

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `fb_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * 记录一条反馈
 */
export async function recordFeedback(params: {
  type: FeedbackType;
  messageId?: string;
  userId?: string;
}): Promise<Feedback> {
  const store = await readStore();

  // 检查是否已存在相同的反馈（防抖）
  const existing = store.feedbacks.find(
    (f) =>
      f.messageId === params.messageId &&
      f.type === params.type &&
      f.status === 'pending'
  );

  if (existing) {
    logger.info('反馈已存在，跳过记录', { id: existing.id });
    return existing;
  }

  const feedback: Feedback = {
    id: generateId(),
    type: params.type,
    messageId: params.messageId,
    userId: params.userId,
    timestamp: new Date().toISOString(),
    status: 'pending',
  };

  store.feedbacks.unshift(feedback); // 最新在前
  await writeStore(store);

  logger.success('记录反馈', { id: feedback.id, type: feedback.type });
  return feedback;
}

/**
 * 获取待处理反馈列表
 */
export async function getPendingFeedbacks(limit = 10): Promise<Feedback[]> {
  const store = await readStore();
  return store.feedbacks
    .filter((f) => f.status === 'pending')
    .slice(0, limit);
}

/**
 * 获取反馈统计
 */
export async function getFeedbackStats(): Promise<FeedbackStats> {
  const store = await readStore();
  const feedbacks = store.feedbacks;

  return {
    total: feedbacks.length,
    pending: feedbacks.filter((f) => f.status === 'pending').length,
    processed: feedbacks.filter((f) => f.status === 'processed').length,
    likes: feedbacks.filter((f) => f.type === 'like').length,
    dislikes: feedbacks.filter((f) => f.type === 'dislike').length,
  };
}

/**
 * 标记反馈为已处理
 */
export async function markFeedbackProcessed(
  feedbackId: string,
  response?: string
): Promise<boolean> {
  const store = await readStore();
  const feedback = store.feedbacks.find((f) => f.id === feedbackId);

  if (!feedback) {
    logger.warn('反馈不存在', { feedbackId });
    return false;
  }

  feedback.status = 'processed';
  if (response) {
    feedback.agentResponse = response;
  }

  await writeStore(store);
  logger.success('反馈已标记处理', { id: feedbackId });
  return true;
}

/**
 * 加载所有反馈（供 Agent 读取）
 */
export async function loadFeedbacks(params?: {
  status?: 'pending' | 'processed';
  limit?: number;
}): Promise<Feedback[]> {
  const store = await readStore();
  let feedbacks = store.feedbacks;

  if (params?.status) {
    feedbacks = feedbacks.filter((f) => f.status === params.status);
  }

  // 按时间倒序
  feedbacks.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  if (params?.limit) {
    feedbacks = feedbacks.slice(0, params.limit);
  }

  return feedbacks;
}
