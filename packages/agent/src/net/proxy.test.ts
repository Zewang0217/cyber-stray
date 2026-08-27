import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { getProxyUrl, getProxyAgent, proxyFetch } from './proxy.js';

const PROXY_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];

describe('net/proxy（#119 代理注入）', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    for (const key of PROXY_KEYS) delete process.env[key];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const key of PROXY_KEYS) delete process.env[key];
  });

  describe('getProxyUrl', () => {
    test('无代理 env 返回 null', () => {
      expect(getProxyUrl()).toBeNull();
    });

    test('HTTPS_PROXY 优先于 HTTP_PROXY', () => {
      process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';
      process.env.HTTP_PROXY = 'http://127.0.0.1:8888';
      expect(getProxyUrl()).toBe('http://127.0.0.1:7890');
    });

    test('HTTP_PROXY 兜底', () => {
      process.env.HTTP_PROXY = 'http://127.0.0.1:8888';
      expect(getProxyUrl()).toBe('http://127.0.0.1:8888');
    });

    test('ALL_PROXY 最后兜底', () => {
      process.env.ALL_PROXY = 'socks5://127.0.0.1:7891';
      expect(getProxyUrl()).toBe('socks5://127.0.0.1:7891');
    });

    test('空值跳过', () => {
      process.env.HTTPS_PROXY = '  ';
      process.env.HTTP_PROXY = '';
      process.env.ALL_PROXY = 'http://127.0.0.1:7890';
      expect(getProxyUrl()).toBe('http://127.0.0.1:7890');
    });

    test('小写 key 同样生效（systemd env 传递场景）', () => {
      process.env.https_proxy = 'http://127.0.0.1:7890';
      expect(getProxyUrl()).toBe('http://127.0.0.1:7890');
    });
  });

  describe('getProxyAgent', () => {
    test('无代理 env 返回 null', () => {
      expect(getProxyAgent()).toBeNull();
    });

    test('有代理 env 返回 ProxyAgent 单例', () => {
      process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';
      const first = getProxyAgent();
      const second = getProxyAgent();
      expect(first).not.toBeNull();
      expect(second).toBe(first);
    });
  });

  describe('proxyFetch', () => {
    type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

    test('无代理时原生 fetch，不注入 dispatcher', async () => {
      const spy = vi.fn<FetchFn>(() => Promise.resolve(new Response('ok')));
      globalThis.fetch = spy as unknown as typeof fetch;
      await proxyFetch('https://example.com');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![1]).toBeUndefined();
    });

    test('有代理时注入 ProxyAgent dispatcher，保留其余 init', async () => {
      process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';
      const spy = vi.fn<FetchFn>(() => Promise.resolve(new Response('ok')));
      globalThis.fetch = spy as unknown as typeof fetch;
      const signal = AbortSignal.timeout(1000);
      await proxyFetch('https://example.com', { signal, headers: { 'User-Agent': 'test' } });
      expect(spy).toHaveBeenCalledTimes(1);
      const init = spy.mock.calls[0]![1];
      expect(init).toBeDefined();
      const proxyInit = init as RequestInit & { dispatcher?: unknown };
      expect(proxyInit.dispatcher).toBeDefined();
      expect(init?.signal).toBe(signal);
      expect(init?.headers).toEqual({ 'User-Agent': 'test' });
    });
  });
});
