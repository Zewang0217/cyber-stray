import { ProxyAgent } from 'undici';

/**
 * 网络代理注入（#119）
 *
 * 产机（京东云 VPS）直连被墙站点失败：read_page/browse_page 抓不到国外网页全文。
 * 产机已有 mihomo（127.0.0.1:7890，规则：国内直连、国外走香港节点），但进程未接入
 * （systemd unit 无 HTTPS_PROXY；Bun fetch 不读环境变量代理）。
 *
 * 做法：读标准代理 env（HTTPS_PROXY/HTTP_PROXY/ALL_PROXY），有则给 fetch 注入
 * undici ProxyAgent dispatcher。无代理 env 时行为与原生 fetch 完全一致。
 * 搜索/推送走 API 域名（国内可达）不动；只动被墙站点的入口。
 */

const PROXY_ENV_KEYS = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
] as const;

/** 代理地址；未配置返回 null。短命 worker 每次读 env，无需缓存。 */
export function getProxyUrl(): string | null {
  for (const key of PROXY_ENV_KEYS) {
    const value = process.env[key];
    if (value && value.trim()) return value;
  }
  return null;
}

let proxyAgent: ProxyAgent | null = null;

/** 懒加载单例 ProxyAgent（连接池复用）；无代理配置返回 null */
export function getProxyAgent(): ProxyAgent | null {
  const url = getProxyUrl();
  if (!url) return null;
  if (!proxyAgent) proxyAgent = new ProxyAgent(url);
  return proxyAgent;
}

/** fetch 包装：有代理 env 时注入 dispatcher，否则原生行为 */
export function proxyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const agent = getProxyAgent();
  if (!agent) return fetch(input, init);
  // Bun 运行时支持 undici dispatcher（内置 undici 实现），但 lib.dom RequestInit 未声明该字段
  const proxyInit = { ...init, dispatcher: agent } as RequestInit;
  return fetch(input, proxyInit);
}
