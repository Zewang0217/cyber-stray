import { readFileSync, existsSync } from 'fs';
import type { AgentConfig } from './types.js';

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
  | 'llmTemperature'
  | 'maxSearchResults'
  | 'maxWanderSteps'
  | 'wanderTemperature'
>;

const defaultBehavior: BehaviorConfig = {
  heartbeatInterval: 5,      // 分钟
  boredomGrowthRate: 5,      // 每次心跳无聊值 +5
  energyRecoveryRate: 2,     // 每次心跳精力 +2
  boredomThreshold: 50,
  energyThreshold: 20,
  llmTemperature: 0.8,       // 高温度增加随机性
  maxSearchResults: 10,
  maxWanderSteps: 10,        // 每次游荡最多 10 步
  wanderTemperature: 0.9,    // 游荡高随机性
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

  // 推送配置（webhook/token 来自环境变量）
  feishuWebhook: process.env.FEISHU_WEBHOOK,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
};

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
 */
export function getDataPath(filename: string): string {
  return `data/${filename}`;
}
