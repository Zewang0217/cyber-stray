/**
 * 赛博街溜子核心类型定义
 */

import type { Catchphrase, PersonalityId } from '@cyber-stray/shared';

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

/** 游荡统计结果 */
export interface WanderResult {
  steps: number;          // 本次游荡步数
  durationMs: number;     // 游荡时长（毫秒）
  spokeTimes: number;     // 调用 speak 的次数
  visitedUrls: string[];  // 访问过的 URL
  endReason: 'rest' | 'max_steps' | 'low_energy' | 'early_stop' | 'error';
}

/** 游荡策略（由兴趣图谱 + 状态生成，注入 prompt） */
export interface WanderStrategy {
  focusTopics: string[];
  explorationMode: 'deep' | 'broad' | 'novel';
  maxSteps: number;
  speakInclination: 'high' | 'normal' | 'low';
  constraints: string[];
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

/** 每租户敏感信息（SaaS：per-tenant secrets，注入而非进程环境变量） */
export interface AgentSecrets {
  /** DeepSeek API key（provider 读取点：secrets 优先，回退 process.env.DEEPSEEK_API_KEY） */
  deepseekApiKey?: string;
  /** Tavily API key（等价于 searchApiKey） */
  tavilyApiKey?: string;
  /** Exa API key（等价于 exaApiKey） */
  exaApiKey?: string;
  /** 飞书 Webhook（等价于 feishuWebhook） */
  feishuWebhook?: string;
  /** Telegram Bot Token（等价于 telegramBotToken） */
  telegramBotToken?: string;
  /** Telegram Chat ID（等价于 telegramChatId） */
  telegramChatId?: string;
  /** 飞书应用 App ID（等价于 larkAppId） */
  larkAppId?: string;
  /** 飞书应用 App Secret（等价于 larkAppSecret） */
  larkAppSecret?: string;
}

/** 套餐执行参数（S11 门控：控制面调度器注入；worker 短命进程内存态） */
export interface PlanExecutionArgs {
  plan: 'free' | 'pro' | 'byok';
  /** 每日推送上限（gate 放行 speak 落盘数；0 = 不限） */
  pushesPerDay: number;
  /** 推送时间窗（本地小时 0-23；null = 全天可推） */
  pushWindowStart: number | null;
  pushWindowEnd: number | null;
}

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

  /** 性格（#90：认领时选择；好奇=基准；控制面经 worker CLI 注入，默认好奇） */
  personality: PersonalityId;
  /** 口头禅（#114：worker CLI 注入的当前有效集合；缺省 = 性格默认组） */
  catchphrases?: Catchphrase[];
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
    maxInterestCount: number;   // 最多兴趣数量
    noveltyBudget: number;      // 探索预算比例（0-1）
    defaultSeeds: string[];       // 默认种子兴趣
    minWeight: number;          // dormancy 阈值
  };

  /** 浏览器探索配置 */
  browser?: {
    /** 是否启用浏览器工具（默认 true） */
    enabled: boolean;
    /** Agent 启动时预热浏览器（默认 true） */
    warmUpOnStart: boolean;
    /** 游荡结束后关闭浏览器（默认 false，常驻模式） */
    closeAfterWander: boolean;
    /** CLI 命令超时毫秒数（默认 30000） */
    timeout: number;
    /** agent-browser 会话名称（默认 'cyber-stray'） */
    sessionName: string;
    /** 启用 --restore 持久化：cookies + localStorage 跨重启保持（默认 true） */
    restore: boolean;
  };

  // Phase 5: 推送价值门控配置（PUSH-01/02）
  pushGate?: {
    enabled: boolean;
    threshold: number;
    weights: {
      interestRelevance: number;
      userPreference: number;
      contentQuality: number;
    };
    calibration: {
      enabled: boolean;
      windowSize: number;
      likeRateHigh: number;
      dislikeRateHigh: number;
      adjustStep: number;
    };
    contentScan: {
      enabled: boolean;
      maxUrlCount: number;
    };
  };

  // Hook 系统配置（RFC #59 §4）
  hooks?: {
    /** 禁用的 hook 名称列表（如 ["quality"]） */
    disabled?: string[];
  };

  /** 每租户敏感信息（由 loadConfig 注入；单用户模式为空对象，回退环境变量） */
  secrets?: AgentSecrets;
  /** 套餐执行参数（S11 门控：控制面注入；未注入 = 单用户模式不设限） */
  plan?: PlanExecutionArgs;
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