import type { AgentConfig } from './types';

/**
 * Agent 配置
 * 敏感信息从环境变量读取
 */
export const config: AgentConfig = {
  // 心跳间隔
  heartbeatInterval: 5,  // 分钟

  // 状态增长速率
  boredomGrowthRate: 5,    // 每次心跳无聊值 +5
  energyRecoveryRate: 2,  // 每次心跳精力 +2

  // 阈值
  boredomThreshold: 50,
  energyThreshold: 20,

  // LLM 配置
  llmModel: process.env.LLM_MODEL || 'deepseek-chat',
  llmTemperature: 0.8,  // 高温度增加随机性

  // ReAct Loop 配置
  maxWanderSteps: 10,      // 每次游荡最多 10 步
  wanderTemperature: 0.9,  // 游荡高随机性

  // 搜索配置
  searchProvider: process.env.SEARCH_PROVIDER || 'duckduckgo',
  searchApiKey: process.env.TAVILY_API_KEY || '',
  maxSearchResults: 10,

  // 推送配置
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