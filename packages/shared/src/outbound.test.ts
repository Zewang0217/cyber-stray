import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

const io = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: io.lookup }));
vi.mock('node:http', () => ({ request: io.request }));
vi.mock('node:https', () => ({ request: io.request }));

import { isPublicAddress, parsePublicHttpUrl, requestPublicUrl } from './outbound.js';

function respond(status: number, headers: Record<string, string>, chunks: string[]) {
  return (_url: URL, _options: unknown, onResponse: (response: Readable) => void) => {
    const req = new EventEmitter();
    Object.assign(req, { destroy: vi.fn(), end: () => {
      const response = Readable.from(chunks.map((chunk) => Buffer.from(chunk)));
      Object.assign(response, { statusCode: status, headers });
      onResponse(response);
    } });
    return req;
  };
}

beforeEach(() => { vi.resetAllMocks(); });

describe('公开网页出站边界', () => {
  it('Bun 启动环境有代理时明确拒绝，禁止未经验证的代理路径', async () => {
    const runtime = process;
    vi.stubGlobal('process', { versions: { ...runtime.versions, bun: '1.3.14' }, env: { HTTPS_PROXY: 'http://proxy.invalid' } });
    io.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    io.request.mockImplementation(respond(200, {}, ['ok']));
    try {
      await expect(requestPublicUrl('https://public.example', { maxBytes: 1024, timeoutMs: 1000 })).rejects.toThrow('Bun 代理');
      expect(io.request).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it('DNS 返回私网地址时拒绝建立连接', async () => {
    io.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(requestPublicUrl('https://private.example', { maxBytes: 1024, timeoutMs: 1000 })).rejects.toThrow('非公网');
    expect(io.request).not.toHaveBeenCalled();
  });

  it('连接使用已验证的 IP，DNS 后续变化不能重新解析到内网', async () => {
    io.lookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const connected: string[] = [];
    io.request.mockImplementation((_url, options, onResponse) => {
      const req = new EventEmitter();
      Object.assign(req, { destroy: vi.fn(), end: () => {
        options.lookup('public.example', {}, (_error: unknown, address: string) => connected.push(address));
        const response = Readable.from([Buffer.from('public content')]);
        Object.assign(response, { statusCode: 200, statusMessage: 'OK', headers: {} });
        onResponse(response);
      } });
      return req;
    });
    const result = await requestPublicUrl('https://public.example', { maxBytes: 1024, timeoutMs: 1000 });
    expect(result.body.toString()).toBe('public content');
    expect(connected).toEqual(['93.184.216.34']);
    expect(io.lookup).toHaveBeenCalledOnce();
  });

  it('Bun 的 all=true 连接解析只返回已验证地址数组', async () => {
    io.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    let connected: unknown;
    io.request.mockImplementation((url, options, onResponse) => {
      options.lookup('public.example', { all: true }, (_error: unknown, addresses: unknown) => { connected = addresses; });
      return respond(200, {}, ['ok'])(url, options, onResponse);
    });
    await requestPublicUrl('https://public.example', { maxBytes: 1024, timeoutMs: 1000 });
    expect(connected).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('公开站点跳转私网时拒绝第二次连接', async () => {
    io.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    io.request.mockImplementation(respond(302, { location: 'http://169.254.169.254/' }, []));
    await expect(requestPublicUrl('https://public.example', { maxBytes: 1024, timeoutMs: 1000, maxRedirects: 3 })).rejects.toThrow('非公网');
    expect(io.request).toHaveBeenCalledOnce();
  });

  it('DNS 卡住也受整次超时约束，不会发起连接', async () => {
    vi.useFakeTimers();
    io.lookup.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const request = requestPublicUrl('https://slow.example', { maxBytes: 1024, timeoutMs: 1000, signal: controller.signal });
    const assertion = expect(request).rejects.toThrow();
    controller.abort(new Error('取消读取'));
    await assertion;
    expect(io.request).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('响应流在 DOM 解析前受字节上限约束', async () => {
    io.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    io.request.mockImplementation(respond(200, {}, ['1234', '5678']));
    await expect(requestPublicUrl('https://public.example', { maxBytes: 5, timeoutMs: 1000 })).rejects.toThrow('字节限制');
  });

  it.each(['127.0.0.1', '10.1.2.3', '169.254.169.254', '100.64.0.1', '192.168.1.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2002:7f00:1::', '2001:db8::1'])('拒绝非公网 %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['http://2130706433', 'http://0x7f000001', 'file:///etc/passwd', 'https://user:password@example.com'])('拒绝异常 URL %s', (url) => {
    expect(() => parsePublicHttpUrl(url)).toThrow();
  });

  it('混合公网与私网 DNS 结果整体拒绝', async () => {
    io.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }]);
    await expect(requestPublicUrl('https://mixed.example', { maxBytes: 1024, timeoutMs: 1000 })).rejects.toThrow('非公网');
    expect(io.request).not.toHaveBeenCalled();
  });
});
