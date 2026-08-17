/**
 * 租户解析 — 服务端取租户的唯一入口（安全硬规矩）
 *
 * 只读 session cookie JWT 的 tenantId claim；**绝不读 x-tenant-* header**——
 * 客户端可控的 header 不能决定租户归属，否则任意请求可越权访问其他租户数据。
 */

import { verifySession, SESSION_COOKIE } from './session.js';

/**
 * 从请求解析当前租户 id 与 session claims。
 *
 * 实现上刻意不读取任何 x-tenant-* header：即使客户端伪造
 * `x-tenant-id: <others>`，返回值仍只由服务端签发的 session JWT 决定。
 *
 * @returns 租户 id + 用户 sub；未登录/会话无效返回 null
 */
export async function resolveTenantFromRequest(
  req: Request,
  sessionSecret: string,
): Promise<{ tenantId: string; sub: string } | null> {
  const cookies = parseCookies(req.headers.get('cookie'));
  const token = cookies.get(SESSION_COOKIE);
  if (!token) return null;

  const claims = await verifySession(token, sessionSecret);
  if (!claims) return null;
  return { tenantId: claims.tenantId, sub: claims.sub };
}

/** 解析 Cookie 头为 Map（session token 是 base64url，不做 URI 解码） */
export function parseCookies(header: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) return map;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    // 值不做 decodeURIComponent：恶意构造的 % 编码会让 500 而非 401；
    // session token 无需解码（base64url 字符集）
    if (name) map.set(name, value);
  }
  return map;
}
