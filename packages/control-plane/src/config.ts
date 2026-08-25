import { fileURLToPath } from 'url';

/**
 * 控制面配置 — 来自环境变量；secrets 密文不落明文。
 * master key：env CP_MASTER_KEY（64 hex）优先，dev 无 env 时自动生成
 * dataDir/master.key（chmod 600，gitignored）——见 secrets/master-key.ts。
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
  /** 调度器 tick 间隔 ms（0 = 关闭；S5） */
  schedulerIntervalMs: number;
  /** 调度器并发上限（2C4G 建议 4） */
  schedulerMaxConcurrent: number;
  /** worker 挂死判定 ms */
  workerTimeoutMs: number;
  /** worker 失败退避 ms */
  workerRetryBackoffMs: number;
  /** 单宠最大重试次数（不含首发） */
  workerMaxRetries: number;
  /** 登录/登出后跳转的 Web 应用地址 */
  webOrigin: string;
  /** 运营管理面板：管理员 Casdoor sub 白名单（逗号分隔 env CP_ADMIN_SUBS） */
  adminSubs: string[];
  /** 火山方舟 API key（生图 Seedream + 视觉质检豆包；#128 生成管线） */
  arkApiKey: string;
  /** 生图模型（env CP_ARK_IMAGE_MODEL；Seedream 5.0 Lite，同步 API） */
  arkImageModel: string;
  /** 视觉质检模型（env CP_ARK_VISION_MODEL；豆包视觉） */
  arkVisionModel: string;
  /** 宠物 IP 生成月度配额（套/自然月；env CP_PETGEN_MONTHLY_QUOTA，默认 2） */
  petGenMonthlyQuota: number;
  /** 生成任务处理器 tick 间隔 ms（0 = 关闭；#94） */
  petGenIntervalMs: number;
  /** 是否日记写完触发表情包生成（#96；env CP_MEME_ENABLED，缺省 true） */
  memeEnabled: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ControlPlaneConfig {
  const sessionSecret = env.CP_SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error('缺少环境变量 CP_SESSION_SECRET（≥32 字节）');
  }

  const numeric: Array<[keyof ControlPlaneConfig, number]> = [
    ['schedulerIntervalMs', Number(env.CP_SCHEDULER_INTERVAL_MS ?? 60_000)],
    ['schedulerMaxConcurrent', Number(env.CP_SCHEDULER_MAX_CONCURRENT ?? 4)],
    ['workerTimeoutMs', Number(env.CP_WORKER_TIMEOUT_MS ?? 10 * 60_000)],
    ['workerRetryBackoffMs', Number(env.CP_SCHEDULER_RETRY_BACKOFF_MS ?? 60_000)],
    ['workerMaxRetries', Number(env.CP_SCHEDULER_MAX_RETRIES ?? 2)],
    ['petGenMonthlyQuota', Number(env.CP_PETGEN_MONTHLY_QUOTA ?? 2)],
    ['petGenIntervalMs', Number(env.CP_PETGEN_INTERVAL_MS ?? 5_000)],
  ];
  for (const [field, value] of numeric) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`环境变量解析失败：${field} = ${value}（须为非负数字）`);
    }
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
    adminSubs: (env.CP_ADMIN_SUBS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    schedulerIntervalMs: Number(env.CP_SCHEDULER_INTERVAL_MS ?? 60_000),
    schedulerMaxConcurrent: Number(env.CP_SCHEDULER_MAX_CONCURRENT ?? 4),
    workerTimeoutMs: Number(env.CP_WORKER_TIMEOUT_MS ?? 10 * 60_000),
    workerRetryBackoffMs: Number(env.CP_SCHEDULER_RETRY_BACKOFF_MS ?? 60_000),
    workerMaxRetries: Number(env.CP_SCHEDULER_MAX_RETRIES ?? 2),
    arkApiKey: env.ARK_API_KEY ?? '',
    arkImageModel: env.CP_ARK_IMAGE_MODEL ?? 'doubao-seedream-5-0-260128',
    arkVisionModel: env.CP_ARK_VISION_MODEL ?? 'doubao-1.5-vision-pro',
    petGenMonthlyQuota: Number(env.CP_PETGEN_MONTHLY_QUOTA ?? 2),
    petGenIntervalMs: Number(env.CP_PETGEN_INTERVAL_MS ?? 5_000),
    memeEnabled: env.CP_MEME_ENABLED !== 'false',
  };
}
