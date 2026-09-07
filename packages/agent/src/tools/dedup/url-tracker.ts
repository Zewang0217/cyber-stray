/**
 * URL 追踪模块 - 跨游荡持久化的 URL 去重机制
 *
 * 功能：
 * - 记录已推送的 URL 及内容摘要
 * - 支持冷却期（默认 5 天）
 * - 软提示 LLM，避免重复推送
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { getDataPath } from '../../config.js';
import { consola } from '../../logger.js';

const logger = consola.withTag('dedup:url-tracker');

export interface VisitedUrlRecord {
  /** 原始 URL */
  url: string;
  /** 标准化 URL 的哈希 */
  hash: string;
  /** 首次访问时间 */
  visitedAt: string;
  /** 最近一次推送内容摘要（最多 100 字） */
  lastContent?: string;
}

export interface VisitedUrlStore {
  version: 1;
  records: VisitedUrlRecord[];
  lastCleanup: string;
}

const DEDUP_DIR = 'dedup';
const VISITED_URLS_FILE = 'visited-urls.json';

/**
 * 创建默认的空存储
 */
function createDefaultStore(): VisitedUrlStore {
  return {
    version: 1,
    records: [],
    lastCleanup: new Date().toISOString(),
  };
}

/**
 * tracking 参数名（L1 去重修复，#152）。
 *
 * 前缀匹配 utm_* 家族；显式集合为各平台点击/分享追踪 ID。
 * 取舍：**宁漏勿误**——漏删只是去重变松（L2 语义层兜底），误删语义参数
 * （如 news?id=）会把不同内容误判为同一 URL，比不删更糟。
 */
const TRACKING_PARAM_PREFIXES = ['utm_'];

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'msclkid', 'dclid', 'yclid', 'ttclid', // 广告点击 ID
  'igshid', 'si', // Instagram/YouTube 分享追踪
  'spm', 'spm_id', 'scm', // ContentSPM 埋点（阿里系）
  'share_token', 'share_source', 'share_medium', 'share_plat', // 分享埋点
  'ref_src', 'ref_url', 'vd_source', 'vd_medium', 'from_source', 'from_medium',
  'app_platform', 'app_version', 'sid_for_share', 'nsukey', 'isappinstalled',
]);

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    TRACKING_PARAM_PREFIXES.some((p) => lower.startsWith(p)) || TRACKING_PARAMS.has(lower)
  );
}

/**
 * 标准化 URL（L1 去重，#152）：去协议与锚点，**选择性删除 tracking 查询参数**，
 * 保留语义参数（`news?id=123` ≠ `news?id=456`）。保留参数按键排序，保证
 * 参数顺序差异不影响去重判定。
 *
 * 旧实现删除全部 query（`.split('?')[0]`），导致 `news?id=123` 与
 * `news?id=456` 误判同链——正是 #147 指出的去重缺陷。
 */
export function normalizeUrl(url: string): string {
  const withoutScheme = url.replace(/^https?:\/\//, '').split('#')[0] ?? '';
  const queryIndex = withoutScheme.indexOf('?');
  if (queryIndex === -1) return withoutScheme;

  const base = withoutScheme.slice(0, queryIndex);
  const kept = withoutScheme
    .slice(queryIndex + 1)
    .split('&')
    .filter((pair) => {
      const key = pair.split('=')[0] ?? '';
      return key.length > 0 && !isTrackingParam(key);
    })
    .sort();
  return kept.length > 0 ? `${base}?${kept.join('&')}` : base;
}

/**
 * 计算 URL 的哈希值（用于快速查找）
 */
export function getUrlHash(url: string): string {
  const normalized = normalizeUrl(url);
  return Buffer.from(normalized).toString('base64url');
}

/**
 * 获取存储文件路径
 */
async function getStorePath(): Promise<string> {
  const dedupDir = getDataPath(DEDUP_DIR);
  if (!existsSync(dedupDir)) {
    await mkdir(dedupDir, { recursive: true });
  }
  return getDataPath(`${DEDUP_DIR}/${VISITED_URLS_FILE}`);
}

/**
 * 加载 URL 追踪存储
 */
export async function loadVisitedUrls(): Promise<VisitedUrlStore> {
  const storePath = await getStorePath();

  if (!existsSync(storePath)) {
    const defaultStore = createDefaultStore();
    await saveVisitedUrls(defaultStore);
    return defaultStore;
  }

  try {
    const content = await readFile(storePath, 'utf-8');
    const store = JSON.parse(content) as VisitedUrlStore;
    // 确保数据结构完整
    if (!store.version) {
      store.version = 1;
    }
    if (!store.records) {
      store.records = [];
    }
    if (!store.lastCleanup) {
      store.lastCleanup = new Date().toISOString();
    }
    return store;
  } catch (error) {
    logger.error('加载 URL 追踪存储失败，使用默认存储:', error);
    return createDefaultStore();
  }
}

/**
 * 保存 URL 追踪存储
 */
export async function saveVisitedUrls(store: VisitedUrlStore): Promise<void> {
  const storePath = await getStorePath();
  const content = JSON.stringify(store, null, 2);
  await writeFile(storePath, content, 'utf-8');
}

/**
 * 获取 URL 的访问记录（如果存在）
 */
export async function getVisitedInfo(
  url: string,
): Promise<VisitedUrlRecord | null> {
  const store = await loadVisitedUrls();
  const hash = getUrlHash(url);
  return store.records.find(r => r.hash === hash) ?? null;
}

/**
 * 检查 URL 是否在冷却期内
 */
export async function isInCooldown(
  url: string,
  cooldownDays: number,
): Promise<boolean> {
  const record = await getVisitedInfo(url);
  if (!record) {
    return false;
  }

  const visitedAt = new Date(record.visitedAt);
  const cooldownEnd = new Date(visitedAt);
  cooldownEnd.setDate(cooldownEnd.getDate() + cooldownDays);

  return new Date() < cooldownEnd;
}

/**
 * 添加 URL 到追踪记录
 */
export async function addVisitedUrl(
  url: string,
  content?: string,
): Promise<void> {
  const store = await loadVisitedUrls();
  const hash = getUrlHash(url);

  const existingIndex = store.records.findIndex(r => r.hash === hash);

  if (existingIndex !== -1 && store.records[existingIndex]) {
    // 已存在，更新内容摘要
    store.records[existingIndex]!.lastContent = content?.slice(0, 100);
    logger.debug('更新已存在 URL 的内容摘要', { url });
  } else {
    // 新增记录
    store.records.push({
      url,
      hash,
      visitedAt: new Date().toISOString(),
      lastContent: content?.slice(0, 100),
    });
    logger.info('添加新 URL 到追踪记录', { url });
  }

  await saveVisitedUrls(store);
}

/**
 * 清理过期的 URL 记录
 * @returns 清理的记录数量
 */
export async function cleanupVisitedUrls(
  daysToKeep: number,
): Promise<number> {
  const store = await loadVisitedUrls();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  const originalCount = store.records.length;
  store.records = store.records.filter(
    record => new Date(record.visitedAt) > cutoffDate,
  );
  store.lastCleanup = new Date().toISOString();

  const removedCount = originalCount - store.records.length;
  if (removedCount > 0) {
    await saveVisitedUrls(store);
    logger.info('清理过期 URL 记录', {
      removedCount,
      remaining: store.records.length,
    });
  }

  return removedCount;
}

/**
 * URL 匹配模式
 *
 * 排除空白、成对括号与中英文句读。ASCII 右括号必须排除——LLM 常写
 * markdown 链接 `[标题](url)`，否则右括号会被吃进 URL。代价是维基百科
 * 那类 URL 里自带括号的链接会被截断，权衡下前者更常见。
 *
 * 注意不要把 ASCII 句号排除掉：那会让所有域名在第一个点处断掉。
 */
const URL_PATTERN = /https?:\/\/[^\s<>"'()（）[\]【】，。！？；：、]+/;

/**
 * 从内容中提取第一个 URL
 */
export function extractUrl(content: string): string | null {
  const urlMatch = content.match(URL_PATTERN);
  if (!urlMatch) {
    return null;
  }
  // 句尾标点常紧贴 URL（"…见 https://a.com/b."），不属于链接本身
  const trimmed = urlMatch[0].replace(/[.,;:!?]+$/, '');
  return trimmed || null;
}
