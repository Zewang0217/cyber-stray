import { readFileSync, existsSync } from 'fs';
import type { AgentConfig, EnergyRecoveryTier } from './types.js';

const CONFIG_PATH = 'data/agent-config.json';

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
  maxWanderSteps: 10,
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
 */
function loadBehaviorConfig(): BehaviorConfig {
  if (existsSync(CONFIG_PATH)) {
    try {
      const file = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Partial<BehaviorConfig>;
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
 * Agent 配置
 * - 行为参数：从 data/agent-config.json 读取，失败时用默认值
 * - 敏感信息：从环境变量读取，不放入配置文件
 */
// CR-04：只读一次 agent-config.json（旧版模块加载期读 4 次，既浪费 I/O 又在并发改文件时
// 可能读到不一致快照）。behavior 已含 W2 嵌套合并后的 consolidation。
const behavior = loadBehaviorConfig();

export const config: AgentConfig = {
  ...behavior,

  // LLM 配置（模型名来自环境变量）
  llmModel: process.env.LLM_MODEL || 'deepseek-chat',

  // 搜索配置（provider/key 来自环境变量）
  searchProvider: process.env.SEARCH_PROVIDER || 'duckduckgo',
  searchApiKey: process.env.TAVILY_API_KEY || '',
  exaApiKey: process.env.EXA_API_KEY || '',

  // 推送配置（webhook/token 来自环境变量）
  feishuWebhook: process.env.FEISHU_WEBHOOK,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,

  // 飞书应用配置（用于卡片交互）
  larkAppId: process.env.LARK_APP_ID,
  larkAppSecret: process.env.LARK_APP_SECRET,

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
};

/**
 * 获取能量对应的恢复阶梯
 */
export function getRecoveryTier(energy: number): EnergyRecoveryTier {
  const tiers = config.energyRecoveryTiers;

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
 */
export function validateConfig(): void {
  const missing: string[] = [];

  if (!process.env.DEEPSEEK_API_KEY) {
    missing.push('DEEPSEEK_API_KEY');
  }

  if (config.searchProvider !== 'duckduckgo' && !config.searchApiKey) {
    missing.push('TAVILY_API_KEY');
  }

  if (!config.feishuWebhook && !config.telegramBotToken) {
    missing.push('FEISHU_WEBHOOK or TELEGRAM_BOT_TOKEN');
  }

  if (missing.length > 0) {
    throw new Error(`缺少必要环境变量: ${missing.join(', ')}`);
  }
}

/**
 * 获取数据目录路径
 *
 * 默认相对于 cwd 的 data/；测试可通过 DATA_DIR 环境变量重定向到临时目录，
 * 避免污染真实数据。env 未设置时与历史行为完全一致。
 */
export function getDataPath(filename: string): string {
  return `${process.env.DATA_DIR ?? 'data'}/${filename}`;
}
