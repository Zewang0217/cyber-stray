import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import type { AgentConfig, AgentSecrets, EnergyRecoveryTier, PlanExecutionArgs } from './types.js';

/**
 * 数据目录锚点：`packages/agent/data`
 *
 * 本文件位于 `packages/agent/src/`，故 `../data` 即包内 data 目录。用
 * import.meta.url 而非 cwd 推导，保证从仓库根、包目录或 pm2/systemd 等任意
 * 工作目录启动，读写的都是同一份数据。
 */
const AGENT_DATA_ROOT = fileURLToPath(new URL('../data', import.meta.url));

// ============================================
// 租户上下文（SaaS：同一进程可先后跑多个租户的游荡）
// ============================================

/** 租户上下文：游荡执行期间的环境基座 */
export interface TenantContext {
  /** 租户键（如 org slug / 注册 id），仅用于标识与日志 */
  tenantId: string;
  /** 该租户隔离的数据目录（DATA_DIR = 租户键） */
  dataDir: string;
  /** 该租户的完整配置（行为参数 + per-tenant secrets） */
  config: AgentConfig;
}

/**
 * 当前租户上下文（模块级环境持有者）。
 *
 * 单用户模式为 null → getDataPath 回退 `DATA_DIR` env / 包内锚点，行为与旧版一致；
 * runOneWander 等租户入口设置后，全包所有调用时求值的 getDataPath() 自动指向租户目录。
 */
let currentTenant: TenantContext | null = null;

export function getTenantContext(): TenantContext | null {
  return currentTenant;
}

/** 设置/清除当前租户上下文（租户入口进入/退出时调用；单用户模式传 null） */
export function setTenantContext(ctx: TenantContext | null): void {
  currentTenant = ctx;
}

/**
 * 获取当前生效的 Agent 配置。
 *
 * 租户模式下返回该租户配置（行为参数 + secrets）；单用户模式返回模块级默认 config。
 * 工具/prompt 等读取配置一律走此函数（或经 getConfig()），不要 import 冻结的 config——
 * 那会把所有租户钉死成首个加载者的配置。
 */
export function getConfig(): AgentConfig {
  return currentTenant?.config ?? config;
}

/**
 * 获取当前生效的数据根目录（租户 dataDir > DATA_DIR env > 包内锚点）。
 * 单例缓存按此值键化，保证租户间不串实例。
 */
export function getDataRoot(): string {
  return currentTenant?.dataDir ?? process.env.DATA_DIR ?? AGENT_DATA_ROOT;
}

/**
 * 获取数据文件路径
 *
 * 默认锚定到 `packages/agent/data`（见 AGENT_DATA_ROOT），与启动时的 cwd 无关；
 * 测试可通过 DATA_DIR 环境变量重定向到临时目录，避免污染真实数据。
 *
 * agent 侧任何数据文件都必须经由此函数取路径，不要再写 `data/xxx` 相对路径——
 * 那种写法绕过 DATA_DIR 且随 cwd 漂移。
 */
export function getDataPath(filename: string): string {
  return join(getDataRoot(), filename);
}

/**
 * 可从配置文件覆盖的行为参数（敏感信息仍从环境变量读取）
 */
type BehaviorConfig = Pick<
  AgentConfig,
  | 'heartbeatInterval'
  | 'boredomGrowthRate'
  | 'energyRecoveryRate'
  | 'boredomThreshold'
  | 'energyThreshold'
  | 'energyRecoveringThreshold'
  | 'energyCostPerStep'
  | 'boredomReductionPerStep'
  | 'wanderProbabilityEnabled'
  | 'wanderProbabilityThreshold'
  | 'energyRecoveryTiers'
  | 'llmTemperature'
  | 'maxSearchResults'
  | 'maxWanderSteps'
  | 'wanderTemperature'
  | 'outputLanguage'
  | 'urlCooldownDays'
  | 'generateTextMaxRetries'
> & {
  feishu?: AgentConfig['feishu'];
  /** D-03 合并/清理阈值（BehaviorConfig 内必填，默认值由 defaultBehavior 提供） */
  consolidation: NonNullable<AgentConfig['consolidation']>;
  /** Phase 2: 兴趣图谱配置 */
  interests: NonNullable<AgentConfig['interests']>;
  /** Phase 5: 推送价值门控配置 */
  pushGate: NonNullable<AgentConfig['pushGate']>;
  /** 浏览器探索配置 */
  browser: NonNullable<AgentConfig['browser']>;
  /** Hook 系统配置（RFC #59 §4）：disabled 列表 */
  hooks?: AgentConfig['hooks'];
};

const defaultBehavior: BehaviorConfig = {
  heartbeatInterval: 10,
  boredomGrowthRate: 5,
  energyRecoveryRate: 2,
  boredomThreshold: 50,
  energyThreshold: 20,
  energyRecoveringThreshold: 30,
  energyCostPerStep: 2,
  boredomReductionPerStep: 2,
  wanderProbabilityEnabled: true,
  wanderProbabilityThreshold: 20,
  energyRecoveryTiers: [
    { maxEnergy: 10, recovery: 10, interval: 30, boredomGrowth: 0 },
    { maxEnergy: 30, recovery: 5, interval: 15, boredomGrowth: 2 },
    { maxEnergy: 100, recovery: 2, interval: 10, boredomGrowth: 5 },
  ] as EnergyRecoveryTier[],
  llmTemperature: 0.8,
  maxSearchResults: 10,
  maxWanderSteps: 100,
  wanderTemperature: 0.9,
  outputLanguage: 'zh-CN',
  urlCooldownDays: 5,
  generateTextMaxRetries: 1,
  consolidation: {
    lowImportanceThreshold: 0.2,
    expiryDays: 60,
    mergeMaxAgeDays: 7,
    urlCleanupDays: 30,
  },
  interests: {
    decayLambda: 0.1,
    maxWeight: 0.8,
    minInterestCount: 3,
    maxInterestCount: 20,
    noveltyBudget: 0.15,
    defaultSeeds: ['科技', 'AI', '互联网'],
    minWeight: 0.05,
  },
  pushGate: {
    enabled: true,
    threshold: 0.5,
    weights: {
      interestRelevance: 0.4,
      userPreference: 0.4,
      contentQuality: 0.2,
    },
    calibration: {
      enabled: true,
      windowSize: 20,
      likeRateHigh: 0.7,
      dislikeRateHigh: 0.3,
      adjustStep: 0.05,
    },
    contentScan: {
      enabled: true,
      maxUrlCount: 5,
    },
  },
  browser: {
    enabled: true,
    warmUpOnStart: true,
    closeAfterWander: false,
    timeout: 30000,
    sessionName: 'cyber-stray',
    restore: true,
  },
};

/**
 * 从 data/agent-config.json 加载行为配置，缺失字段回退到默认值
 *
 * **W2 嵌套合并（数据安全）**：`consolidation` 是嵌套对象，浅合并
 * `{ ...defaultBehavior, ...file }` 会因用户只配部分字段（如仅 expiryDays）导致
 * 整个对象被覆盖 → 其余字段 undefined → 误阈值/误归档/数据丢失。因此对嵌套的
 * `consolidation` 显式做字段级合并：用户字段覆盖默认，未配字段从默认取。
 *
 * @param dataDir 指定数据目录（租户模式）；缺省走当前生效数据根（getDataPath）
 */
function loadBehaviorConfig(dataDir?: string): BehaviorConfig {
  const configPath = dataDir ? join(dataDir, 'agent-config.json') : getDataPath('agent-config.json');
  if (existsSync(configPath)) {
    try {
      const file = JSON.parse(readFileSync(configPath, 'utf-8')) as Partial<BehaviorConfig>;
      return {
        ...defaultBehavior,
        ...file,
        // W2：嵌套对象显式字段级合并，防部分配置致 undefined 阈值
        consolidation: {
          ...defaultBehavior.consolidation,
          ...(file.consolidation ?? {}),
        },
        // Phase 2: 兴趣图谱配置嵌套合并
        interests: {
          ...defaultBehavior.interests,
          ...(file.interests ?? {}),
        },
        // Phase 5: 推送门控配置嵌套合并
        pushGate: {
          ...defaultBehavior.pushGate,
          ...(file.pushGate ?? {}),
          weights: {
            ...defaultBehavior.pushGate.weights,
            ...(file.pushGate?.weights ?? {}),
          },
          calibration: {
            ...defaultBehavior.pushGate.calibration,
            ...(file.pushGate?.calibration ?? {}),
          },
          contentScan: {
            ...defaultBehavior.pushGate.contentScan,
            ...(file.pushGate?.contentScan ?? {}),
          },
        },
        // 浏览器探索配置嵌套合并
        browser: {
          ...defaultBehavior.browser,
          ...(file.browser ?? {}),
        },
      };
    } catch (err) {
      console.warn(`[config] agent-config.json 解析失败，使用默认配置: ${err}`);
    }
  }
  return defaultBehavior;
}

/**
 * 组装 Agent 配置
 * - 行为参数：从 data/agent-config.json 读取，失败时用默认值
 * - 敏感信息：secrets 显式注入优先，未注入的字段回退环境变量（单用户模式）
 */
export function loadConfig(
  dataDir?: string,
  secrets?: AgentSecrets,
  planArgs?: PlanExecutionArgs,
): AgentConfig {
  const behavior = loadBehaviorConfig(dataDir);
  const s = secrets ?? {};
  // BYOK：租户 BYOK 模式下 deepseekApiKey 缺失时**不回退平台 env**——
  // 平台 token 不能替 BYOK 用户烧（那是付费墙反向漏洞）。缺 key 的游荡
  // 会在 provider 构造处显式抛错（显式失败优于静默换 key）。
  const deepseekApiKey =
    s.deepseekApiKey ?? (planArgs?.plan === 'byok' ? undefined : process.env.DEEPSEEK_API_KEY);
  return {
    ...behavior,

    // LLM 配置（模型名来自环境变量）
    llmModel: process.env.LLM_MODEL || 'deepseek-chat',

    // 搜索配置（provider/key 来自环境变量，per-tenant 可经 secrets 覆盖）
    searchProvider: process.env.SEARCH_PROVIDER || 'duckduckgo',
    searchApiKey: s.tavilyApiKey ?? process.env.TAVILY_API_KEY ?? '',
    exaApiKey: s.exaApiKey ?? process.env.EXA_API_KEY ?? '',

    // 推送配置（webhook/token 来自环境变量，per-tenant 可经 secrets 覆盖）
    feishuWebhook: s.feishuWebhook ?? process.env.FEISHU_WEBHOOK,
    telegramBotToken: s.telegramBotToken ?? process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: s.telegramChatId ?? process.env.TELEGRAM_CHAT_ID,

    // 飞书应用配置（用于卡片交互）
    larkAppId: s.larkAppId ?? process.env.LARK_APP_ID,
    larkAppSecret: s.larkAppSecret ?? process.env.LARK_APP_SECRET,

    // 飞书行为配置（CR-04：嵌套字段级合并，与 consolidation 的 W2 一致——用户只配部分字段时
    // 其余从默认取，不致 undefined。旧版 spread 后又被重建对象覆盖，首读结果被丢弃。）
    feishu: {
      pushMode: behavior.feishu?.pushMode ?? 'lark_channel',
      receiveMode: behavior.feishu?.receiveMode ?? 'reaction',
      chatId: behavior.feishu?.chatId ?? '',
    },

    // Phase 2: 兴趣图谱配置
    interests: behavior.interests,

    // Phase 5: 推送价值门控配置
    pushGate: behavior.pushGate,

    // 浏览器探索配置
    browser: behavior.browser,

    // per-tenant secrets（provider 读取点：secrets.deepseekApiKey 优先于环境变量；
    // BYOK 缺 key 时为 undefined——provider 构造处显式抛错，不烧平台 token）
    secrets: { ...s, ...(s.deepseekApiKey ? {} : { deepseekApiKey }) },

    // 套餐执行参数（S11 门控：日预算 + 推送窗口）
    plan: planArgs,
  };
}

// CR-04：只读一次 agent-config.json（旧版模块加载期读 4 次，既浪费 I/O 又在并发改文件时
// 可能读到不一致快照）。behavior 已含 W2 嵌套合并后的 consolidation。
const behavior = loadBehaviorConfig();

/** 单用户默认配置（无租户上下文时生效；租户模式请用 getConfig()） */
export const config: AgentConfig = loadConfig();

/**
 * 获取能量对应的恢复阶梯
 */
export function getRecoveryTier(energy: number): EnergyRecoveryTier {
  const tiers = getConfig().energyRecoveryTiers;

  for (const tier of tiers) {
    if (energy <= tier.maxEnergy) {
      return tier;
    }
  }

  // 默认为最高阶梯
  return tiers[tiers.length - 1]!;
}

/**
 * 验证必要配置
 *
 * 租户模式下按租户配置 + 租户 secrets 校验；单用户模式校验模块级 config + 环境变量。
 */
export function validateConfig(): void {
  const missing: string[] = [];
  const cfg = getConfig();

  // BYOK：secrets 已在 loadConfig 处理（缺 key 即 undefined），这里不回退
  // env 校验——否则 BYOK 缺 key 会被平台 env 掩盖
  const deepseekApiKey =
    cfg.plan?.plan === 'byok'
      ? cfg.secrets?.deepseekApiKey
      : (cfg.secrets?.deepseekApiKey ?? process.env.DEEPSEEK_API_KEY);
  if (!deepseekApiKey) {
    missing.push(cfg.plan?.plan === 'byok' ? 'DEEPSEEK_API_KEY (BYOK 未绑定)' : 'DEEPSEEK_API_KEY');
  }

  if (cfg.searchProvider !== 'duckduckgo' && !cfg.searchApiKey) {
    missing.push('TAVILY_API_KEY');
  }

  if (!cfg.feishuWebhook && !cfg.telegramBotToken) {
    missing.push('FEISHU_WEBHOOK or TELEGRAM_BOT_TOKEN');
  }

  if (missing.length > 0) {
    throw new Error(`缺少必要环境变量: ${missing.join(', ')}`);
  }
}
