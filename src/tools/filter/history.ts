import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { getDataPath } from '../../config.js';
import { consola } from '../../logger.js';
import type { SearchResult } from '../../types.js';

const logger = consola.withTag('filter-history');

export interface PushedItem {
  hash: string;
  url: string;
  title: string;
  pushedAt: string;
  topic?: string;
}

export interface PushHistory {
  pushedUrls: PushedItem[];
  lastCleanup: string;
}

const MAX_HISTORY_SIZE = 100;
const HISTORY_FILE = 'history/pushed.json';

function createDefaultHistory(): PushHistory {
  return {
    pushedUrls: [],
    lastCleanup: new Date().toISOString(),
  };
}

function normalizeUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').split('?')[0]?.split('#')[0] ?? '';
}

export function getUrlHash(url: string): string {
  const normalized = normalizeUrl(url);
  return Buffer.from(normalized).toString('base64');
}

export async function loadPushHistory(): Promise<PushHistory> {
  const historyPath = getDataPath(HISTORY_FILE);

  if (!existsSync(historyPath)) {
    const defaultHistory = createDefaultHistory();
    await savePushHistory(defaultHistory);
    return defaultHistory;
  }

  try {
    const content = await readFile(historyPath, 'utf-8');
    return JSON.parse(content) as PushHistory;
  } catch (error) {
    logger.error('加载推送历史失败，使用默认历史:', error);
    return createDefaultHistory();
  }
}

export async function savePushHistory(history: PushHistory): Promise<void> {
  const historyPath = getDataPath(HISTORY_FILE);
  const content = JSON.stringify(history, null, 2);
  await writeFile(historyPath, content, 'utf-8');
}

export async function isPushed(url: string): Promise<boolean> {
  const history = await loadPushHistory();
  const hash = getUrlHash(url);
  return history.pushedUrls.some(item => item.hash === hash);
}

export async function addToHistory(
  result: SearchResult,
  topic?: string,
): Promise<void> {
  const history = await loadPushHistory();
  const hash = getUrlHash(result.url);

  if (history.pushedUrls.some(item => item.hash === hash)) {
    logger.warn('URL 已存在于历史中，跳过添加', { url: result.url });
    return;
  }

  const newItem: PushedItem = {
    hash,
    url: result.url,
    title: result.title,
    pushedAt: new Date().toISOString(),
    topic,
  };

  history.pushedUrls.push(newItem);

  if (history.pushedUrls.length > MAX_HISTORY_SIZE) {
    history.pushedUrls = history.pushedUrls.slice(-MAX_HISTORY_SIZE);
    history.lastCleanup = new Date().toISOString();
    logger.info('清理历史记录，保留最近 100 条');
  }

  await savePushHistory(history);
  logger.info('添加推送记录', { url: result.url, title: result.title });
}

export async function cleanupHistory(daysToKeep: number = 30): Promise<number> {
  const history = await loadPushHistory();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  const originalCount = history.pushedUrls.length;
  history.pushedUrls = history.pushedUrls.filter(
    item => new Date(item.pushedAt) > cutoffDate,
  );
  history.lastCleanup = new Date().toISOString();

  const removedCount = originalCount - history.pushedUrls.length;
  if (removedCount > 0) {
    await savePushHistory(history);
    logger.info('清理过期历史', { removedCount, remaining: history.pushedUrls.length });
  }

  return removedCount;
}