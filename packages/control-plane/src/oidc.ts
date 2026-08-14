/**
 * OIDC provider 封装（Casdoor）
 *
 * 手写 PKCE authorization code flow + jose v5 验 id_token。
 *
 * 为什么不用 openid-client：其 5.7.1 的请求层（got）在 Bun 运行时下拿不到
 * JSON 响应体（jwks 校验报 "must be a JSON Web Key Set"），与 Bun 不兼容。
 * 本实现只用 fetch（Bun 原生）+ jose v5（createLocalJWKSet/jwtVerify），
 * 全部经 Bun 验证可行。
 *
 * 流程：discovery → authorize（PKCE S256 + state + nonce）→ exchange code
 * → 验 id_token（签名 + iss/aud/exp/nonce）→ 返回用户。
 */

import * as jose from 'jose';
import type { ControlPlaneConfig } from './config.js';

/** OIDC 登录用户 */
export interface OidcUser {
  sub: string;
  email?: string;
  name?: string;
}

/** OIDC provider 抽象（测试注入点） */
export interface OidcProvider {
  /** 生成 Casdoor 授权 URL；返回 { url, state, nonce, verifier }（回调时配对） */
  buildAuthUrl(): Promise<{
    url: string;
    state: string;
    nonce: string;
    verifier: string;
  }>;
  /** 处理回调 URL，返回登录用户；state/验签失败抛错 */
  handleCallback(
    callbackUrl: string,
    expectedState: string,
    nonce: string,
    verifier: string,
  ): Promise<OidcUser>;
}

/** OIDC discovery 结果 */
interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}

/** 真机实现：Casdoor OIDC（fetch + jose v5） */
export function createCasdoorOidc(config: ControlPlaneConfig): OidcProvider {
  let discoveryPromise: Promise<OidcDiscovery> | null = null;

  async function getDiscovery(): Promise<OidcDiscovery> {
    if (!discoveryPromise) {
      discoveryPromise = (async () => {
        if (!config.casdoorClientId || !config.casdoorClientSecret) {
          throw new Error('缺少 CASDOOR_CLIENT_ID / CASDOOR_CLIENT_SECRET');
        }
        const res = await fetch(
          `${config.casdoorIssuer}/.well-known/openid-configuration`,
        );
        if (!res.ok) {
          throw new Error(`OIDC discovery 失败: HTTP ${res.status}`);
        }
        const data = (await res.json()) as OidcDiscovery;
        if (
          !data.authorization_endpoint ||
          !data.token_endpoint ||
          !data.jwks_uri ||
          !data.issuer
        ) {
          throw new Error('OIDC discovery 响应缺少必要端点');
        }
        return data;
      })().catch((error: unknown) => {
        // 失败不缓存：清空让下次调用重试（如 Casdoor 启动晚于控制面）
        discoveryPromise = null;
        throw error;
      });
    }
    return discoveryPromise;
  }

  return {
    async buildAuthUrl() {
      const discovery = await getDiscovery();
      const verifier = jose.base64url.encode(
        crypto.getRandomValues(new Uint8Array(32)),
      );
      const challenge = jose.base64url.encode(
        new Uint8Array(
          await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
        ),
      );
      const nonce = jose.base64url.encode(
        crypto.getRandomValues(new Uint8Array(16)),
      );
      const state = jose.base64url.encode(
        crypto.getRandomValues(new Uint8Array(18)),
      );
      const params = new URLSearchParams({
        client_id: config.casdoorClientId,
        response_type: 'code',
        scope: 'openid profile email',
        redirect_uri: config.casdoorRedirectUri,
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      return {
        url: `${discovery.authorization_endpoint}?${params}`,
        state,
        nonce,
        verifier,
      };
    },

    async handleCallback(callbackUrl, expectedState, nonce, verifier) {
      const discovery = await getDiscovery();
      const url = new URL(callbackUrl);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code) throw new Error('回调缺少 code');
      if (state !== expectedState) throw new Error('state 不匹配');

      // exchange code → token
      const tokenRes = await fetch(discovery.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: config.casdoorClientId,
          client_secret: config.casdoorClientSecret,
          code,
          redirect_uri: config.casdoorRedirectUri,
          code_verifier: verifier,
        }),
      });
      if (!tokenRes.ok) {
        throw new Error(`token 交换失败: HTTP ${tokenRes.status}`);
      }
      const tokenData = (await tokenRes.json()) as { id_token?: string };
      if (!tokenData.id_token) throw new Error('token 响应缺少 id_token');

      // 验 id_token：签名（JWKS）+ iss/aud/exp + nonce
      const jwksRes = await fetch(discovery.jwks_uri);
      if (!jwksRes.ok) throw new Error(`JWKS 获取失败: HTTP ${jwksRes.status}`);
      const jwks = (await jwksRes.json()) as jose.JSONWebKeySet;
      const keys = jose.createLocalJWKSet(jwks);

      let payload: jose.JWTPayload;
      try {
        const { payload: verified } = await jose.jwtVerify(tokenData.id_token, keys, {
          issuer: discovery.issuer,
          audience: config.casdoorClientId,
        });
        payload = verified;
      } catch (error) {
        throw new Error(
          `id_token 验证失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (nonce && payload.nonce !== nonce) {
        throw new Error('id_token nonce 不匹配');
      }
      if (typeof payload.sub !== 'string') {
        throw new Error('id_token 缺少 sub');
      }
      return {
        sub: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        name: typeof payload.name === 'string' ? payload.name : undefined,
      };
    },
  };
}
