/**
 * 赛博街溜子核心类型定义
 */

// ============================================
// 状态相关
// ============================================

/** Agent 心情类型 */
export type Mood = 'curious' | 'grumpy' | 'playful' | 'lazy' | 'excited' | 'emo';

/** Agent 状态 */
export interface AgentState {
  // 基础状态
  boredom: number;       // 无聊值 0-100
  energy: number;        // 精力值 0-100
  mood: Mood;            // 心情

  // 个性参数
  temper: number;        // 脾气值 0-100（高=容易罢工）
  stubbornness: number;  // 固执程度 0-100（高=不听用户反馈）

  // 记忆
  lastActionTime: string | null;            // 上次行动时间 ISO 格式
  recentTopics: string[];                   // 最近搜过的话题
  userLikes: string[];                      // 用户喜欢的话题
  userDislikes: string[];                   // 用户不喜欢的话题

  // Agent 个性化（ReAct 架构新增）
  /** @deprecated 由 InterestGraph 驱动，保留以兼容现有序列化 */
  agentInterests: string[];    // Agent 自己的兴趣图谱（LLM 自主维护）

  // 统计
  totalWanders: number;         // 总游荡次数（ReAct 架构）
  totalSteps: number;           // 总游荡步数（ReAct 架构）
  totalPushes: number;          // 总推送次数
  consecutiveFailures: number;  // 连续失败次数

  // 时间感知
  lastHeartbeat: string;        // 上次心跳时间 ISO 格式
  lastWander: string | null;    // 上次游荡时间（ReAct 架构）
  lastRest: string | null;      // 上次休息时间
}

/** 游荡步骤记录（ReAct 架构） */
export interface WanderStep {
  timestamp: string;
  tool: string;           // 调用的 Tool 名称
  thought?: string;       // LLM 内心独白（可选）
  url?: string;           // 如果访问了某个 URL
  spoke?: string;         // 如果调用了 speak，记录内容
}

// ============================================
// 搜索与推送相关
// ============================================
// ============================================

/** 搜索结果 */
export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

/** 推送内容 */
export interface PushContent {
  title: string;
  url: string;
  summary: string;
  message: string;      // 人格化文案
  mood: Mood;
  timestamp: string;
}

// ============================================
// 用户反馈
// ============================================

/** 反馈类型 */
export type FeedbackType = 'like' | 'dislike';

/** 用户反馈 */
export interface Feedback {
  type: FeedbackType;
  topic: string;
  contentId: string;    // 推送内容标识（URL hash）
  timestamp: string;
}

// ============================================
// 配置相关
// ============================================

/** 阶梯恢复配置 */
export interface EnergyRecoveryTier {
  maxEnergy: number;      // 该阶梯的最大能量值（用于判断是否适用此阶梯）
  recovery: number;        // 恢复量
  interval: number;        // 心跳间隔（分钟）
  boredomGrowth: number;  // 该阶梯下的无聊值增长率
}

/** Agent 配置 */
export interface AgentConfig {
  // 心跳间隔（分钟）
  heartbeatInterval: number;

  // 状态增长速率
  boredomGrowthRate: number;    // 每次心跳无聊值增长
  energyRecoveryRate: number;   // 每次心跳精力恢复

  // 阈值
  boredomThreshold: number;      // 触发游荡的无聊值阈值
  energyThreshold: number;       // 能量过低阈值
  energyRecoveringThreshold: number;  // 精力恢复阈值，低于此值时暂停无聊值增长

  // 消耗参数
  energyCostPerStep: number;     // 每步消耗的精力
  boredomReductionPerStep: number;  // 每步降低的无聊值

  // 概率触发配置
  wanderProbabilityEnabled: boolean;  // 是否启用概率触发 wander
  wanderProbabilityThreshold: number; // 低于此能量时概率控制生效（0-100）

  // 阶梯恢复配置
  energyRecoveryTiers: EnergyRecoveryTier[];
  
  // LLM 配置
  llmModel: string;
  llmTemperature: number;

  // ReAct Loop 配置（新增）
  maxWanderSteps: number;        // 每次游荡最大步数（安全上限）
  wanderTemperature: number;     // 游荡 LLM 温度（高随机性）
  
  // 搜索配置
  searchProvider: string;
  searchApiKey: string;     // Tavily API key
  exaApiKey: string;        // Exa API key
  maxSearchResults: number;
  
  // 输出语言配置
  outputLanguage: string;

  // 推送配置
  feishuWebhook?: string;
  telegramBotToken?: string;
  telegramChatId?: string;

  // 飞书应用配置（用于卡片交互）
  larkAppId?: string;
  larkAppSecret?: string;

  // 飞书行为配置
  feishu?: {
    pushMode: 'lark_channel' | 'webhook';
    receiveMode: 'reaction' | 'webhook' | 'none';
    chatId?: string;
  };

  // URL 去重配置
  urlCooldownDays: number;  // URL 冷却天数

  // LLM 调用容错配置（D-10：generateText 整体失败重试次数）
  generateTextMaxRetries: number;  // 重试次数（总 attempts = 此值 + 1）

  // 记忆合并/清理阈值（D-03 外置到 agent-config.json；默认值由 config.ts defaultBehavior 提供）
  consolidation?: {
    lowImportanceThreshold: number;
    expiryDays: number;
    mergeMaxAgeDays: number;
    urlCleanupDays: number;
  };

  // Phase 2: 兴趣图谱配置（INT-01/02）
  interests?: {
    decayLambda: number;        // 衰减系数（每天）
    maxWeight: number;          // 单兴趣权重上限
    minInterestCount: number;   // 最少兴趣数量
    noveltyBudget: number;      // 探索预算比例（0-1）
    defaultSeeds: string[];       // 默认种子兴趣
    minWeight: number;          // dormancy 阈值
  };
}

// ============================================
// 日志相关
// ============================================

/** 日志级别 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 日志条目 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}