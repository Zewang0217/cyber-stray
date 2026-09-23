/**
 * session JWT — 控制面自签会话（stateless）：登录成功后签发 HS256 JWT
 * （sub + tenantId）存 httpOnly cookie。后续请求只认这个 JWT——租户真相
 * 的唯一来源，绝不读客户端可控的 header。
 */

import { SignJWT, jwtVerify } from 'jose';

/** cookie 名契约在 shared（web 中间件登录墙同源） */
export { SESSION_COOKIE } from '@cyber-stray/shared/session';

/** session claims */
export interface SessionClaims {
  /** Casdoor 用户标识（sub） */
  sub: string;
  /** 租户 id（= sub：单用户租户；建关系表后可能分化） */
  tenantId: string;
}

const SESSION_ISSUER = 'cyber-stray-control-plane';
const SESSION_AUDIENCE = 'cyber-stray-web';

/** 签发 session JWT */
export async function signSession(
  claims: SessionClaims,
  secret: string,
  ttlSeconds = 60 * 60 * 24 * 7,
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ tenantId: claims.tenantId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(key);
}

/** 验证 session JWT；无效/过期返回 null（不抛） */
export async function verifySession(
  token: string,
  secret: string,
): Promise<SessionClaims | null> {
  const key = new TextEncoder().encode(secret);
  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
    });
    if (typeof payload.sub !== 'string' || typeof payload.tenantId !== 'string') {
      return null;
    }
    return { sub: payload.sub, tenantId: payload.tenantId };
  } catch {
    return null;
  }
}
