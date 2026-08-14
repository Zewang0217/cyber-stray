import { fileURLToPath } from 'url';

/**
 * 控制面配置 — 全部来自环境变量，无配置文件（secrets 不落盘）
 */

/** 控制面运行配置 */
export interface ControlPlaneConfig {
  /** HTTP 端口（默认 8787） */
  port: number;
  /** Casdoor issuer（OIDC discovery 根） */
  casdoorIssuer: string;
  casdoorClientId: string;
  casdoorClientSecret: string;
  /** OIDC 回调地址（浏览器视角，经 web rewrites 同域代理后到达本服务） */
  casdoorRedirectUri: string;
  /** session JWT HMAC 密钥（≥32 字节） */
  sessionSecret: string;
  /** session 有效期秒数（默认 7 天） */
  sessionTtlSeconds: number;
  /** 控制面数据根（租户注册表 + tenants/ 目录） */
  dataDir: string;
  /** 登录/登出后跳转的 Web 应用地址 */
  webOrigin: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ControlPlaneConfig {
  const sessionSecret = env.CP_SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error('缺少环境变量 CP_SESSION_SECRET（≥32 字节）');
  }

  return {
    port: Number(env.CP_PORT ?? 8787),
    casdoorIssuer: env.CASDOOR_ISSUER ?? 'http://localhost:8000',
    casdoorClientId: env.CASDOOR_CLIENT_ID ?? '',
    casdoorClientSecret: env.CASDOOR_CLIENT_SECRET ?? '',
    casdoorRedirectUri:
      env.CASDOOR_REDIRECT_URI ?? 'http://localhost:3000/api/auth/callback',
    sessionSecret,
    sessionTtlSeconds: Number(env.CP_SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 7),
    dataDir:
      env.CP_DATA_DIR ?? fileURLToPath(new URL('../data', import.meta.url)),
    webOrigin: env.CP_WEB_ORIGIN ?? 'http://localhost:3000',
  };
}
