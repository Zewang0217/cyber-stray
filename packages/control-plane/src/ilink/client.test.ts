/**
 * iLink 客户端测试（#97）——mock fetch 覆盖 9 端点 + 错误语义。
 *
 * 契约：
 * - 9 端点 URL/方法/头（AuthorizationType / Bearer / X-WECHAT-UIN）正确
 * - ret=-2 双语义：'unknown error' → 会话失效；其他 → 限流 3× 指数退避
 * - errcode=-14 → 会话过期；其他 ret → IlinkApiError
 * - >2000 字自然边界分块 + 块间延时
 * - get_bot_qrcode / get_qrcode_status 阶段可不带 token
 */

import { describe, it, expect, vi } from 'vitest';
import {
  IlinkClient,
  IlinkSessionInvalidError,
  IlinkRateLimitError,
  IlinkApiError,
  IlinkNetworkError,
  chunkText,
  randomWechatUin,
} from './client.js';

const BASE = 'https://mock.ilink.test';
const TOKEN = 'v1_test_token';

/** 记录请求的假 fetch */
function makeFetch(handler: (url: string, init: RequestInit) => unknown) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: string | null }> = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const headers = Object.fromEntries(
      Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k, String(v)]),
    );
    calls.push({ url: u, method: init?.method ?? 'GET', headers, body: (init?.body as string) ?? null });
    const result = handler(u, init ?? {});
    const text = typeof result === 'string' ? result : JSON.stringify(result);
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
  });
  // Bun 的全局 fetch 带 preconnect 扩展属性；vi.fn 不含 → 显式断言为 fetch 型
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

describe('chunkText 自然边界分块', () => {
  it('≤2000 字不切块', () => {
    expect(chunkText('短文本', 2000)).toEqual(['短文本']);
  });

  it('段落边界优先', () => {
    const text = `${'a'.repeat(1200)}\n${'b'.repeat(1200)}`;
    const chunks = chunkText(text, 2000);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(`${'a'.repeat(1200)}\n`); // 换行符归前块
    expect(chunks[1]).toBe('b'.repeat(1200));
    expect(chunks[1]?.length).toBe(1200);
  });

  it('单段超长：空格边界；无空格硬切（按字符，CJK 安全）', () => {
    const text = `${'word '.repeat(600)}`; // 3000 字符
    const chunks = chunkText(text, 2000);
    expect(chunks.length).toBe(2);
    expect(chunks[0]?.endsWith(' ')).toBe(true);
    expect(chunks[0]?.length).toBeLessThanOrEqual(2000);

    const cjk = '你'.repeat(2500);
    const cjkChunks = chunkText(cjk, 2000);
    expect(cjkChunks).toEqual(['你'.repeat(2000), '你'.repeat(500)]);
  });
});

describe('IlinkClient 请求构造', () => {
  it('公共头：AuthorizationType + Bearer + X-WECHAT-UIN 存在', async () => {
    const { fetchFn, calls } = makeFetch(() => ({ qrcode: 'abc', qrcode_img_content: 'https://qr' }));
    const client = new IlinkClient({ baseUrl: BASE, botToken: TOKEN, fetchFn });
    await client.getBotQrcode();
    const call = calls[0]!;
    expect(call.headers.AuthorizationType).toBe('ilink_bot_token');
    expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(call.headers['X-WECHAT-UIN']).toBeTruthy();
    expect(call.headers['X-WECHAT-UIN']).toBeTruthy();
    expect(call.headers['Content-Type']).toBe('application/json');
  });

  it('randomWechatUin：base64 可解码且每次随机', () => {
    const a = Buffer.from(randomWechatUin(), 'base64').toString();
    const b = Buffer.from(randomWechatUin(), 'base64').toString();
    expect(/^\d+$/.test(a)).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('端点 1+2：get_bot_qrcode / get_qrcode_status', () => {
  it('get_bot_qrcode：POST /ilink/bot/get_bot_qrcode?bot_type=3，body 带 local_token_list', async () => {
    const { fetchFn, calls } = makeFetch(() => ({ qrcode: 'hex123', qrcode_img_content: 'https://weixin.qq.com/q/xyz' }));
    const client = new IlinkClient({ baseUrl: BASE, fetchFn });
    const resp = await client.getBotQrcode({ localTokenList: ['tok1'] });
    expect(resp.qrcode).toBe('hex123');
    const call = calls[0]!;
    expect(call.url).toBe(`${BASE}/ilink/bot/get_bot_qrcode?bot_type=3`);
    expect(call.method).toBe('POST');
    expect(JSON.parse(call.body ?? '')).toEqual({ local_token_list: ['tok1'] });
    // 无 token 阶段不带头（Authorization 缺失）
    expect(call.headers.Authorization).toBeUndefined();
  });

  it('get_bot_qrcode 响应缺字段 → IlinkApiError', async () => {
    const { fetchFn } = makeFetch(() => ({}));
    const client = new IlinkClient({ baseUrl: BASE, fetchFn });
    await expect(client.getBotQrcode()).rejects.toThrow(IlinkApiError);
  });

  it('get_qrcode_status：GET 长轮询带 qrcode 查询参数', async () => {
    const { fetchFn, calls } = makeFetch(() => ({ status: 'scaned' }));
    const client = new IlinkClient({ baseUrl: BASE, fetchFn });
    const resp = await client.getQrcodeStatus('hex123');
    expect(resp.status).toBe('scaned');
    expect(calls[0]!.url).toBe(`${BASE}/ilink/bot/get_qrcode_status?qrcode=hex123`);
  });
});

describe('端点 3：getupdates 长轮询', () => {
  it('携带 get_updates_buf 游标，返回消息 + 新游标', async () => {
    const { fetchFn, calls } = makeFetch(() => ({
      msgs: [{ from_user_id: 'u@im.wechat', item_list: [{ type: 1, text_item: { text: 'hi' } }], context_token: 'tok' }],
      get_updates_buf: 'cursor-v2',
    }));
    const client = new IlinkClient({ baseUrl: BASE, botToken: TOKEN, fetchFn });
    const resp = await client.getUpdates({ getUpdatesBuf: 'cursor-v1' });
    expect(resp.get_updates_buf).toBe('cursor-v2');
    expect(resp.msgs?.[0]?.context_token).toBe('tok');
    const call = calls[0]!;
    expect(call.url).toBe(`${BASE}/ilink/bot/getupdates`);
    expect(JSON.parse(call.body ?? '').get_updates_buf).toBe('cursor-v1');
  });

  it('errcode=-14 → 会话过期（IlinkSessionInvalidError）', async () => {
    const { fetchFn } = makeFetch(() => ({ errcode: -14, errmsg: 'session timeout' }));
    const client = new IlinkClient({ baseUrl: BASE, botToken: TOKEN, fetchFn });
    await expect(client.getUpdates()).rejects.toThrow(IlinkSessionInvalidError);
  });
});

describe('端点 4：sendmessage 与 ret 语义', () => {
  it('成功：HTTP 200 空 body（text 空）不抛', async () => {
    const { fetchFn } = makeFetch(() => '');
    const client = new IlinkClient({ baseUrl: BASE, botToken: TOKEN, fetchFn });
    await expect(client.sendMessage('u@im.wechat', '你好')).resolves.toBeUndefined();
  });

  it('成功：ret=0 + context_token 原样回传', async () => {
    const { fetchFn, calls } = makeFetch(() => ({ ret: 0 }));
    const client = new IlinkClient({ baseUrl: BASE, botToken: TOKEN, fetchFn });
    await client.sendMessage('u@im.wechat', '回复', { contextToken: 'ctx-1' });
    const body = JSON.parse(calls[0]!.body ?? '');
    expect(body.msg.to_user_id).toBe('u@im.wechat');
    expect(body.msg.from_user_id).toBe('');
    expect(body.msg.message_type).toBe(2);
    expect(body.msg.message_state).toBe(2);
    expect(body.msg.item_list).toEqual([{ type: 1, text_item: { text: '回复' } }]);
    expect(body.msg.context_token).toBe('ctx-1');
    expect(body.msg.client_id).toBeTruthy();
  });

  it('ret=-2 + errmsg=unknown error → 会话失效（不重试）', async () => {
    let calls = 0;
    const { fetchFn } = makeFetch(() => {
      calls++;
      return { ret: -2, errmsg: 'unknown error' };
    });
    const client = new IlinkClient({ baseUrl: BASE, botToken: TOKEN, fetchFn, rateLimitRetries: 3 });
    await expect(client.sendMessage('u@im.wechat', 'x')).rejects.toThrow(IlinkSessionInvalidError);
    expect(calls).toBe(1); // 不重试
  });

  it('ret=-2 其他 errmsg → 限流 3× 指数退避后抛 IlinkRateLimitError', async () => {
    const backoffs: number[] = [];
    let calls = 0;
    const sleepFn = vi.fn(async (ms: number) => {
      backoffs.push(ms);
    });
    const { fetchFn } = makeFetch(() => {
      calls++;
      return { ret: -2, errmsg: 'frequency limit' };
    });
    const client = new IlinkClient({
      baseUrl: BASE, botToken: TOKEN, fetchFn, sleepFn,
      rateLimitRetries: 3, rateLimitBackoffBaseMs: 100,
    });
    await expect(client.sendMessage('u@im.wechat', 'x')).rejects.toThrow(IlinkRateLimitError);
    expect(calls).toBe(4); // 初始 + 3 次重试
    expect(backoffs).toEqual([100, 300, 900]); // 指数退避 base × 3^i
  });

  it('限流后重试成功（第二次放行）', async () => {
    let calls = 0;
    const { fetchFn } = makeFetch(() => {
      calls++;
      return calls === 1 ? { ret: -2, errmsg: 'frequency limit' } : { ret: 0 };
    });
    const client = new IlinkClient({ baseUrl: BASE, botToken: TOKEN, fetchFn, rateLimitBackoffBaseMs: 1 });
    await expect(client.sendMessage('u@im.wechat', 'x')).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  it('ret=其他（如 -3）→ IlinkApiError', async () => {
    const { fetchFn } = makeFetch(() => ({ ret: -3, errmsg: 'bad param' }));
    const client = new IlinkClient({ baseUrl: BASE, botToken: TOKEN, fetchFn });
    await expect(client.sendMessage('u@im.wechat', 'x')).rejects.toThrow(IlinkApiError);
  });

  it('HTTP 非 2xx → IlinkNetworkError', async () => {
    const fetchFn = vi.fn(async () => new Response('oops', { status: 500 }));
    const client = new IlinkClient({ baseUrl: BASE, botToken: TOKEN, fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.sendMessage('u@im.wechat', 'x')).rejects.toThrow(IlinkNetworkError);
  });
});

describe('端点 5+6：getconfig / sendtyping', () => {
  it('getconfig 返回 typing_ticket', async () => {
    const { fetchFn, calls } = makeFetch(() => ({ ret: 0, typing_ticket: 'ticket-1' }));
    const client = new IlinkClient({ baseUrl: BASE, botToken: TOKEN, fetchFn });
    const resp = await client.getConfig();
    expect(resp.typing_ticket).toBe('ticket-1');
    expect(calls[0]!.url).toBe(`${BASE}/ilink/bot/getconfig`);
  });

  it('sendtyping 带 typing_ticket + status', async () => {
    const { fetchFn, calls } = makeFetch(() => ({ ret: 0 }));
    const client = new IlinkClient({ baseUrl: BASE, botToken: TOKEN, fetchFn });
    await client.sendTyping({ ilink_user_id: 'u@im.wechat', typing_ticket: 'ticket-1', status: 1 });
    const body = JSON.parse(calls[0]!.body ?? '');
    expect(body.typing_ticket).toBe('ticket-1');
    expect(body.status).toBe(1);
    expect(calls[0]!.url).toBe(`${BASE}/ilink/bot/sendtyping`);
  });
});

describe('端点 7-9：媒体 CDN（首版后置，仅封装验证）', () => {
  it('getuploadurl：POST /ilink/bot/getuploadurl 返回 upload_full_url', async () => {
    const { fetchFn, calls } = makeFetch(() => ({ ret: 0, upload_full_url: 'https://cdn/up' }));
    const client = new IlinkClient({ baseUrl: BASE, botToken: TOKEN, fetchFn });
    const resp = await client.getUploadUrl({ media_type: 1, to_user_id: 'u@im.wechat' });
    expect(resp.upload_full_url).toBe('https://cdn/up');
    expect(calls[0]!.url).toBe(`${BASE}/ilink/bot/getuploadurl`);
  });

  it('uploadCdn：POST 到 uploadUrl 带 x-encrypted-param', async () => {
    const { fetchFn, calls } = makeFetch(() => 'ok');
    const client = new IlinkClient({ baseUrl: BASE, botToken: TOKEN, fetchFn });
    await client.uploadCdn('https://cdn/up', 'param-1', 'binary');
    expect(calls[0]!.url).toBe('https://cdn/up');
    expect(calls[0]!.headers['x-encrypted-param']).toBe('param-1');
  });

  it('downloadCdn：GET 到下载 URL', async () => {
    const { fetchFn, calls } = makeFetch(() => 'data');
    const client = new IlinkClient({ baseUrl: BASE, botToken: TOKEN, fetchFn });
    const res = await client.downloadCdn('https://cdn/dl');
    expect(res.ok).toBe(true);
    expect(calls[0]!.url).toBe('https://cdn/dl');
  });
});

describe('分块发送 sendTextChunked', () => {
  it('>2000 字分块发送，块间延时，各块独立 client_id', async () => {
    const { fetchFn, calls } = makeFetch(() => ({ ret: 0 }));
    const sleeps: number[] = [];
    const sleepFn = vi.fn(async (ms: number) => { sleeps.push(ms); });
    const client = new IlinkClient({ baseUrl: BASE, botToken: TOKEN, fetchFn, sleepFn, chunkDelayMs: 1500, chunkSize: 2000 });
    const text = `${'word '.repeat(600)}`; // 3000 字符 → 2 块
    const clientIds = await client.sendTextChunked('u@im.wechat', text, { contextToken: 'ctx' });
    expect(clientIds).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([1500]); // 块间一次延时
    const body0 = JSON.parse(calls[0]!.body ?? '');
    const body1 = JSON.parse(calls[1]!.body ?? '');
    expect(body0.msg.context_token).toBe('ctx');
    expect(body0.msg.client_id).not.toBe(body1.msg.client_id);
  });

  it('≤2000 字单块发送', async () => {
    const { fetchFn, calls } = makeFetch(() => ({ ret: 0 }));
    const client = new IlinkClient({ baseUrl: BASE, botToken: TOKEN, fetchFn, chunkDelayMs: 0 });
    await client.sendTextChunked('u@im.wechat', '短消息');
    expect(calls).toHaveLength(1);
  });
});
