import { describe, test, expect, beforeEach, afterEach } from 'vitest';
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
    // 全部走 mock：api.duckduckgo.com 在被污染的 DNS 环境下解析到 Facebook 段
    // （face:b00c）直接 ETIMEDOUT——真网用例在任何此类网络必挂，改为确定性验证
    // 请求构建 + 正常解析路径（解析细节由下方"解析 Abstract"用例承担）
    const mockData = {
      AbstractText: 'TypeScript is a strongly typed programming language',
      AbstractURL: 'https://www.typescriptlang.org/',
      AbstractSource: 'Wikipedia',
      RelatedTopics: [
        { Text: 'TypeScript - A typed superset of JavaScript', FirstURL: 'https://example.com/ts' },
      ],
    };
    let requestedUrl = '';
    globalThis.fetch = ((input: string | URL | Request) => {
      requestedUrl = String(input);
      return Promise.resolve(
        new Response(JSON.stringify(mockData), { headers: { 'Content-Type': 'application/json' } }),
      );
    }) as unknown as typeof fetch;

    const results = await adapter.search('typescript');

    // 请求构建：查询与 json 格式参数正确
    expect(requestedUrl).toContain('https://api.duckduckgo.com/');
    expect(requestedUrl).toContain('q=typescript');
    expect(requestedUrl).toContain('format=json');
    expect(requestedUrl).toContain('skip_disambig=1');

    // 正常路径返回可用的结果结构
    expect(results.length).toBeGreaterThan(0);
    const first = results[0]!;
    expect(first.url).toMatch(/^https?:\/\//);
    expect(first.content).toBeTruthy();
  });

  test('搜索无结果话题返回空数组', async () => {
    // DDG 对无结果查询返回空对象（无 Abstract / 无 RelatedTopics）
    mockFetch(new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } }));
    const results = await adapter.search('qwertyuiopasdfghjklzzzzz');
    expect(Array.isArray(results)).toBe(true);
    expect(results).toEqual([]);
  });

  test('maxResults 限制结果数量', async () => {
    const topics = Array.from({ length: 8 }, (_, i) => ({
      Text: `Topic ${i} - description ${i}`,
      FirstURL: `https://example.com/${i}`,
    }));
    mockFetch(
      new Response(JSON.stringify({ RelatedTopics: topics }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const results = await adapter.search('javascript', { maxResults: 3 });
    expect(results.length).toBe(3);
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
