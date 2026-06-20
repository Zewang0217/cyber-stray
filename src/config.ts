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
};

/**
 * 从 data/agent-config.json 加载行为配置，缺失字段回退到默认值
 */
function loadBehaviorConfig(): BehaviorConfig {
  if (existsSync(CONFIG_PATH)) {
    try {
      const file = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Partial<BehaviorConfig>;
      return { ...defaultBehavior, ...file };
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
export const config: AgentConfig = {
  ...loadBehaviorConfig(),

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

  // 飞书行为配置（从 agent-config.json 读取）
  feishu: {
    pushMode: loadBehaviorConfig().feishu?.pushMode || 'lark_channel',
    receiveMode: loadBehaviorConfig().feishu?.receiveMode || 'reaction',
    chatId: loadBehaviorConfig().feishu?.chatId || '',
  },
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
