import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  normalizeUrl,
  getUrlHash,
  extractUrl,
  isInCooldown,
  addVisitedUrl,
  cleanupVisitedUrls,
  getVisitedInfo,
  loadVisitedUrls,
  saveVisitedUrls,
} from './url-tracker.js';
import { useTempDataDir } from '../../test/helpers.js';

describe('url-tracker 纯函数', () => {
  test('normalizeUrl 去协议/锚点，保留语义 query（L1 修复 #152）', () => {
    expect(normalizeUrl('https://a.com/b?x=1#y')).toBe('a.com/b?x=1');
    expect(normalizeUrl('http://a.com/b')).toBe('a.com/b');
    // 语义参数保留：不同 id 是不同内容，不再误判同链
    expect(normalizeUrl('https://news.com/item?id=123')).toBe('news.com/item?id=123');
    expect(normalizeUrl('https://news.com/item?id=456')).toBe('news.com/item?id=456');
  });

  test('normalizeUrl 删 tracking 参数（utm_* 家族 + 已知点击 ID）', () => {
    expect(normalizeUrl('https://a.com/b?utm_source=x&utm_medium=y&id=1')).toBe('a.com/b?id=1');
    expect(normalizeUrl('https://a.com/b?fbclid=ABC&spm=123.45')).toBe('a.com/b');
    // 仅 tracking 参数被删光 → query 整段消失
    expect(normalizeUrl('https://a.com/b?utm_campaign=z')).toBe('a.com/b');
  });

  test('normalizeUrl 参数排序归一（顺序差异不影响去重）', () => {
    expect(normalizeUrl('https://a.com/b?id=1&type=x')).toBe(
      normalizeUrl('https://a.com/b?type=x&id=1'),
    );
  });

  test('getUrlHash 对相同归一化 URL 返回相同 hash', () => {
    expect(getUrlHash('https://a.com/b?utm_source=x')).toBe(getUrlHash('http://a.com/b'));
    expect(getUrlHash('https://news.com/item?id=123')).not.toBe(
      getUrlHash('https://news.com/item?id=456'),
    );
  });

  test('extractUrl 提取完整 URL（含域名中的点）', () => {
    expect(extractUrl('看这个 https://example.com/page')).toBe('https://example.com/page');
    expect(extractUrl('https://blog.rust-lang.org/2026/07/30/x')).toBe(
      'https://blog.rust-lang.org/2026/07/30/x',
    );
  });

  test('extractUrl 剥掉紧贴的句尾标点', () => {
    expect(extractUrl('见 https://example.com/page.')).toBe('https://example.com/page');
    expect(extractUrl('见 https://example.com/page，然后')).toBe('https://example.com/page');
  });

  test('extractUrl 不把 markdown 链接的右括号吃进 URL', () => {
    expect(extractUrl('[标题](https://example.com/a)')).toBe('https://example.com/a');
  });

  test('extractUrl 无 URL 文本返回 null', () => {
    expect(extractUrl('没有链接的文本')).toBeNull();
  });
});

describe('url-tracker 持久化', () => {
  let cleanup: () => void;

  beforeEach(() => {
    ({ cleanup } = useTempDataDir());
  });

  afterEach(() => {
    cleanup();
  });

  test('addVisitedUrl 后该 URL 处于冷却期内', async () => {
    await addVisitedUrl('https://example.com/a', '内容摘要');
    expect(await isInCooldown('https://example.com/a', 5)).toBe(true);
  });

  test('超过冷却期返回 false', async () => {
    await addVisitedUrl('https://example.com/b');
    const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;
    const store = await loadVisitedUrls();
    const rec = store.records.find((r) => r.hash === getUrlHash('https://example.com/b'));
    expect(rec).toBeDefined();
    rec!.visitedAt = new Date(Date.now() - SIX_DAYS_MS).toISOString();
    await saveVisitedUrls(store);

    expect(await isInCooldown('https://example.com/b', 5)).toBe(false);
  });

  test('addVisitedUrl 对重复 URL 更新摘要、不新增记录', async () => {
    await addVisitedUrl('https://example.com/c', '旧摘要');
    await addVisitedUrl('https://example.com/c', '新摘要');

    const info = await getVisitedInfo('https://example.com/c');
    expect(info?.lastContent).toBe('新摘要');

    const store = await loadVisitedUrls();
    const matches = store.records.filter((r) => r.hash === getUrlHash('https://example.com/c'));
    expect(matches).toHaveLength(1);
  });

  test('cleanupVisitedUrls 删除过期记录', async () => {
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const store = await loadVisitedUrls();
    store.records.push({
      url: 'https://old.com/x',
      hash: getUrlHash('https://old.com/x'),
      visitedAt: new Date(Date.now() - THIRTY_DAYS_MS).toISOString(),
    });
    await saveVisitedUrls(store);

    const removed = await cleanupVisitedUrls(5);
    expect(removed).toBe(1);
    expect(await getVisitedInfo('https://old.com/x')).toBeNull();
  });
});
