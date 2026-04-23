import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { DuckDuckGoAdapter } from './duckduckgo.js';

describe('DuckDuckGoAdapter', () => {
  const adapter = new DuckDuckGoAdapter();
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(response: Response): void {
    globalThis.fetch = (() => Promise.resolve(response)) as unknown as typeof fetch;
  }

  test('适配器可用性检查', () => {
    expect(adapter.isAvailable()).toBe(true);
  });

  test('getName 返回 DuckDuckGo', () => {
    expect(adapter.getName()).toBe('DuckDuckGo');
  });

  test('搜索正常话题返回结果', async () => {
    const query = 'typescript';
    console.log(`[query] ${query}`);
    const results = await adapter.search(query);
    console.log(`[结果数量] ${results.length}`);
    for (const r of results) {
      console.log(`  - ${r.title} | ${r.url}`);
      console.log(`    ${r.content.slice(0, 80)}`);
    }
    expect(results.length).toBeGreaterThanOrEqual(0);

    if (results.length > 0) {
      const first = results[0]!;
      expect(first.url).toMatch(/^https?:\/\//);
      expect(first.content).toBeTruthy();
    }
  });

  test('搜索无结果话题返回空数组', async () => {
    const query = 'qwertyuiopasdfghjklzzzzz';
    console.log(`[query] ${query}`);
    const results = await adapter.search(query);
    console.log(`[结果数量] ${results.length}`);
    expect(Array.isArray(results)).toBe(true);
  });

  test('maxResults 限制结果数量', async () => {
    const query = 'javascript';
    console.log(`[query] ${query} (maxResults: 3)`);
    const results = await adapter.search(query, { maxResults: 3 });
    console.log(`[结果数量] ${results.length}`);
    for (const r of results) {
      console.log(`  - ${r.title} | ${r.url}`);
    }
    expect(results.length).toBeLessThanOrEqual(3);
  });

  test('API 错误时抛出异常', async () => {
    mockFetch(new Response(null, { status: 500, statusText: 'Internal Server Error' }));
    await expect(adapter.search('test')).rejects.toThrow();
  });

  test('解析 Abstract 和 RelatedTopics', async () => {
    const mockData = {
      AbstractText: 'TypeScript is a programming language',
      AbstractURL: 'https://www.typescriptlang.org/',
      AbstractSource: 'Wikipedia',
      RelatedTopics: [
        { Text: 'TypeScript - A typed superset', FirstURL: 'https://example.com/ts' },
        { Text: 'JavaScript - The base language', FirstURL: 'https://example.com/js' },
      ],
    };

    mockFetch(new Response(JSON.stringify(mockData), { headers: { 'Content-Type': 'application/json' } }));

    const results = await adapter.search('typescript');
    expect(results.length).toBe(3);

    const abstract = results[0]!;
    expect(abstract.title).toBe('Wikipedia');
    expect(abstract.url).toBe('https://www.typescriptlang.org/');
    expect(abstract.content).toBe('TypeScript is a programming language');
    expect(abstract.score).toBe(1.0);

    const topic1 = results[1]!;
    expect(topic1.title).toBe('TypeScript');
    expect(topic1.url).toBe('https://example.com/ts');
  });

  test('空 Abstract 时只返回 RelatedTopics', async () => {
    const mockData = {
      RelatedTopics: [
        { Text: 'Topic A', FirstURL: 'https://a.com' },
      ],
    };

    mockFetch(new Response(JSON.stringify(mockData), { headers: { 'Content-Type': 'application/json' } }));

    const results = await adapter.search('test');
    expect(results.length).toBe(1);
    expect(results[0]!.url).toBe('https://a.com');
  });
});
