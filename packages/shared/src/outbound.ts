/** Node 专用：不可信 URL 的出站网络边界。 */
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';

const PRIVATE_V4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) PRIVATE_V4.addSubnet(address, prefix, 'ipv4');
const GLOBAL_V6 = new BlockList();
GLOBAL_V6.addSubnet('2000::', 3, 'ipv6');
const SPECIAL_V6 = new BlockList();
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) {
  SPECIAL_V6.addSubnet(address, prefix, 'ipv6');
}

/** 仅允许全球单播地址；映射 IPv4、转换网段、链路本地、保留地址均拒绝。 */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) return !PRIVATE_V4.check(address, 'ipv4');
  return isIP(address) === 6 && GLOBAL_V6.check(address, 'ipv6') && !SPECIAL_V6.check(address, 'ipv6');
}

/** 语法检查不能替代 DNS 与连接时校验；实际发送必须经 requestPublicUrl。 */
export function parsePublicHttpUrl(input: string): URL {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('仅允许不含凭据的 HTTP(S) URL');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname) && !isPublicAddress(hostname)) throw new Error('拒绝非公网地址');
  return url;
}

/** 推送订阅只能发往 HTTPS；DNS 与实际连接检查在每次发送时执行。 */
export function parsePushEndpoint(input: string): URL {
  const url = parsePublicHttpUrl(input);
  if (url.protocol !== 'https:') throw new Error('推送地址必须使用 HTTPS');
  return url;
}

/** 飞书/Lark 群机器人官方 webhook；禁止相似域名、任意端口与其他 API。 */
export function parseFeishuWebhook(input: string): URL {
  const url = parsePushEndpoint(input);
  if (!['open.feishu.cn', 'open.larksuite.com'].includes(url.hostname) || url.port ||
      !/^\/open-apis\/bot\/v2\/hook\/[a-zA-Z0-9-]+$/.test(url.pathname) || url.search || url.hash) {
    throw new Error('须使用飞书或 Lark 官方群机器人 webhook 地址');
  }
  return url;
}

export interface PublicRequestOptions {
  maxBytes: number;
  timeoutMs: number;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  signal?: AbortSignal;
  /** 默认不跟随跳转；仅无凭据 GET 读公开页面可显式放开。 */
  maxRedirects?: number;
}

export interface PublicResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  url: string;
}

async function resolvePublicAddress(url: URL) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(hostname);
  const addresses = family ? [{ address: hostname, family }] : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('拒绝非公网 DNS 地址');
  }
  return addresses[0]!;
}

async function readResponse(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maxBytes) throw new Error(`响应体超过 ${maxBytes} 字节限制`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** 单次连接固定已检查的 IP，TLS SNI/证书与 Host 仍使用原域名。 */
async function requestPinned(url: URL, options: PublicRequestOptions, signal: AbortSignal): Promise<PublicResponse> {
  const address = await resolvePublicAddress(url);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request(url, {
      method: options.method ?? 'GET', headers: options.headers, signal,
      agent: false, family: address.family,
      lookup: (_hostname, lookupOptions, callback) => {
        // Bun 要求 all=true 返回数组；无论运行时形式如何，都只返回已验证的同一个 IP。
        if (lookupOptions.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
    }, (response) => {
      void readResponse(response, options.maxBytes).then((body) => {
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body, url: url.href });
      }).catch((error: unknown) => { response.destroy(); req.destroy(); reject(error); });
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

/**
 * 请求不可信公开 URL：每次连接 DNS 全地址校验并钉住实际连接 IP。
 * 使用直连 Node HTTP，环境代理不能绕过该边界；响应大小限制在解码/DOM 解析前生效。
 */
export async function requestPublicUrl(input: string, options: PublicRequestOptions): Promise<PublicResponse> {
  if (process.versions.bun && Object.entries(process.env).some(([key, value]) => /^(?:https?|all)_proxy$/i.test(key) && value)) {
    throw new Error('Bun 代理环境无法保证直连出站边界；请以无代理环境启动服务，或先部署经过验证的网络隔离');
  }
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([followRedirects(input, options, signal), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

async function followRedirects(input: string, options: PublicRequestOptions, signal: AbortSignal): Promise<PublicResponse> {
  let url = parsePublicHttpUrl(input);
  const maxRedirects = options.maxRedirects ?? 0;
  for (let hop = 0; ; hop++) {
    const response = await requestPinned(url, options, signal);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (options.method === 'POST' || hop >= maxRedirects) throw new Error('拒绝重定向或重定向次数超限');
    const location = response.headers.location;
    if (!location) throw new Error('重定向缺少 Location');
    url = parsePublicHttpUrl(new URL(location, url).href);
  }
}
