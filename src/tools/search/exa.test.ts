import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { ExaAdapter } from './exa.js';

describe('ExaAdapter', () => {
  const apiKey = process.env.EXA_API_KEY || '';
  const adapter = new ExaAdapter(apiKey);
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
    expect(adapter.isAvailable()).toBe(Boolean(apiKey));
  });

  test('getName 返回 Exa', () => {
    expect(adapter.getName()).toBe('Exa');
  });

  test('搜索英文话题返回结果', async () => {
    if (!process.env.EXA_API_KEY) {
      console.log('跳过：未配置 EXA_API_KEY');
      return;
    }
    const query = 'today tech news';
    console.log(`[query] ${query}`);
    const results = await adapter.search(query);
    console.log(`[结果数量] ${results.length}`);
    for (const r of results.slice(0, 5)) {
      console.log(`  - ${r.title} | ${r.url}`);
    }
    expect(results.length).toBeGreaterThan(0);

    const first = results[0]!;
    expect(first.url).toMatch(/^https?:\/\//);
    expect(first.content).toBeTruthy();
  });

  test('搜索中文话题返回结果', async () => {
    if (!process.env.EXA_API_KEY) {
      console.log('跳过：未配置 EXA_API_KEY');
      return;
    }
    const query = '最新人工智能进展';
    console.log(`[query] ${query}`);
    const results = await adapter.search(query);
    console.log(`[结果数量] ${results.length}`);
    for (const r of results.slice(0, 5)) {
      console.log(`  - ${r.title} | ${r.url}`);
    }
    expect(results.length).toBeGreaterThan(0);
  });

  test('maxResults 限制结果数量', async () => {
    if (!process.env.EXA_API_KEY) {
      console.log('跳过：未配置 EXA_API_KEY');
      return;
    }
    const query = 'javascript';
    console.log(`[query] ${query} (maxResults: 3)`);
    const results = await adapter.search(query, { maxResults: 3 });
    console.log(`[结果数量] ${results.length}`);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  test('API 错误时抛出异常', async () => {
    mockFetch(new Response(null, { status: 500, statusText: 'Internal Server Error' }));
    await expect(adapter.search('test')).rejects.toThrow();
  });

  test('解析 Exa 响应数据', async () => {
    const mockData = {
      results: [
        { title: 'AI News Today', url: 'https://ai.com', text: 'Latest AI developments', publishedDate: '2024-01-01' },
        { title: 'Tech Trends', url: 'https://tech.com', text: 'Emerging technologies' },
      ],
    };

    mockFetch(new Response(JSON.stringify(mockData), { headers: { 'Content-Type': 'application/json' } }));

    const results = await adapter.search('test');
    expect(results.length).toBe(2);

    const first = results[0]!;
    expect(first.title).toBe('AI News Today');
    expect(first.url).toBe('https://ai.com');
    expect(first.content).toBe('Latest AI developments');
    expect(first.score).toBe(1.0);

    const second = results[1]!;
    expect(second.title).toBe('Tech Trends');
    expect(second.content).toBe('Emerging technologies');
  });
});