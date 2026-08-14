/**
 * 认证路由 — /api/auth/*
 *
 * login：跳 Casdoor 授权（PKCE + state）
 * callback：验 state → 换 id_token → 首登自动建租户 → 签发 session → 设 cookie → 跳 web
 * logout：清 session cookie → 跳 web
 * me：解析 session → 返回当前用户/租户（未登录 401）
 */

import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { ControlPlaneConfig } from '../config.js';
import type { OidcProvider } from '../oidc.js';
import { StateStore } from '../state-store.js';
import { signSession, SESSION_COOKIE } from '../session.js';
import { getOrCreateTenant } from '../tenant.js';
import { resolveTenantFromRequest } from '../request-tenant.js';

export interface AuthDeps {
  config: ControlPlaneConfig;
  oidc: OidcProvider;
  states: StateStore;
}

export function createAuthRoutes({ config, oidc, states }: AuthDeps): Hono {
  const app = new Hono();

  /** 登录：跳转 Casdoor 授权页 */
  app.get('/login', async (c) => {
    const { url, state, nonce, verifier } = await oidc.buildAuthUrl();
    states.set(state, nonce, verifier); // state 防 CSRF 重放，一次性
    return c.redirect(url, 302);
  });

  /** 回调：换 token → 建租户 → 签 session */
  app.get('/callback', async (c) => {
    const state = c.req.query('state');
    const entry = state ? states.consume(state) : null;
    if (!state || !entry) {
      return c.json({ error: 'state 无效或已过期' }, 401);
    }

    let user;
    try {
      user = await oidc.handleCallback(c.req.url, state, entry.nonce, entry.verifier);
    } catch (error) {
      console.error('[auth] OIDC 回调失败', error);
      return c.json(
        { error: `OIDC 回调校验失败: ${error instanceof Error ? error.message : String(error)}` },
        401,
      );
    }

    // 首登自动建租户（租户键 = sub；幂等）
    const { tenantId, created } = await getOrCreateTenant(config.dataDir, user.sub);

    // 签发控制面 session
    const token = await signSession(
      { sub: user.sub, tenantId },
      config.sessionSecret,
      config.sessionTtlSeconds,
    );

    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: config.sessionTtlSeconds,
      // HTTPS 部署（webOrigin=https）时要求加密传输；本地 http 开发不设
      secure: config.webOrigin.startsWith('https'),
      // 不设 Domain：走 web rewrites/反代时 cookie 归浏览器看到的源
    });

    return c.redirect(config.webOrigin, 302);
  });

  /** 登出：清 session cookie */
  app.post('/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.redirect(config.webOrigin, 302);
  });

  /** 当前用户/租户（受保护） */
  app.get('/me', async (c) => {
    const session = await resolveTenantFromRequest(c.req.raw, config.sessionSecret);
    if (!session) {
      return c.json({ error: '未登录' }, 401);
    }
    return c.json({ sub: session.sub, tenantId: session.tenantId });
  });

  return app;
}
