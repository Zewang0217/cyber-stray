import { describe, expect, it, vi } from 'vitest';
import { readPage } from './reader.js';

vi.mock('../../net/proxy.js', () => ({ proxyFetch: vi.fn(async () => new Response('<html><title>private</title><p>private service</p></html>')) }));

describe('read_page 网络边界', () => {
  it('不能通过 URL 读取回环与元数据服务', async () => {
    for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/']) {
      const result = await readPage(url);
      expect(result.error).toContain('非公网');
      expect(result.content).toBe('');
    }
  });
});
