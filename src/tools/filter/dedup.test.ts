import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { dedupByUrl, dedupResults } from './dedup.js';
import { getUrlHash } from './history.js';
import type { SearchResult } from '../../types.js';

describe('dedup', () => {
  test('getUrlHash 对相同 URL 返回相同 hash', () => {
    const url1 = 'https://example.com/path?query=1';
    const url2 = 'https://example.com/path?query=2';
    const url3 = 'http://example.com/path';

    const hash1 = getUrlHash(url1);
    const hash2 = getUrlHash(url2);
    const hash3 = getUrlHash(url3);

    expect(hash1).toBe(hash2);
    expect(hash1).toBe(hash3);
  });

  test('getUrlHash 对不同 URL 返回不同 hash', () => {
    const url1 = 'https://example.com/path1';
    const url2 = 'https://example.com/path2';

    const hash1 = getUrlHash(url1);
    const hash2 = getUrlHash(url2);

    expect(hash1).not.toBe(hash2);
  });

  test('dedupByUrl 去除重复 URL', () => {
    const results: SearchResult[] = [
      { title: 'A', url: 'https://example.com/a', content: 'Content A' },
      { title: 'A Duplicate', url: 'https://example.com/a?query=1', content: 'Content A dup' },
      { title: 'B', url: 'https://example.com/b', content: 'Content B' },
      { title: 'B Duplicate', url: 'https://example.com/b#section', content: 'Content B dup' },
      { title: 'C', url: 'https://example.com/c', content: 'Content C' },
    ];

    const deduped = dedupByUrl(results);

    expect(deduped.length).toBe(3);
    expect(deduped.map(r => r.title)).toEqual(['A', 'B', 'C']);
  });

  test('dedupByUrl 对无重复结果不变', () => {
    const results: SearchResult[] = [
      { title: 'A', url: 'https://a.com', content: 'Content A' },
      { title: 'B', url: 'https://b.com', content: 'Content B' },
      { title: 'C', url: 'https://c.com', content: 'Content C' },
    ];

    const deduped = dedupByUrl(results);

    expect(deduped.length).toBe(3);
  });

  test('dedupByUrl 空数组返回空数组', () => {
    const deduped = dedupByUrl([]);
    expect(deduped.length).toBe(0);
  });

  test('dedupResults 组合 URL 和历史去重', async () => {
    const results: SearchResult[] = [
      { title: 'A', url: 'https://unique.com/a', content: 'Unique content' },
      { title: 'B', url: 'https://unique.com/b', content: 'Unique content B' },
      { title: 'A Dup', url: 'https://unique.com/a?query=1', content: 'Duplicate' },
    ];

    const deduped = await dedupResults(results);

    expect(deduped.length).toBeLessThanOrEqual(2);
    expect(deduped.map(r => r.url)).not.toContain('https://unique.com/a?query=1');
  });
});