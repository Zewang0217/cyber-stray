/**
 * 赛博街溜子核心类型定义
 */

// ============================================
// 状态相关
// ============================================

/** Agent 心情类型 */
export type Mood = 'curious' | 'grumpy' | 'playful' | 'lazy' | 'excited' | 'emo';

/** 狩猎结果类型 */
export type HuntResult = 'success' | 'fail' | 'boring' | 'no_result';

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
  lastAction: ActionType | null;           // 上次行动
  lastActionTime: string | null;            // 上次行动时间 ISO 格式
  /** @deprecated 使用 lastWander 替代 */
  lastHuntResult: HuntResult | null;        // 上次狩猎结果
  recentTopics: string[];                   // 最近搜过的话题
  userLikes: string[];                      // 用户喜欢的话题
  userDislikes: string[];                   // 用户不喜欢的话题

  // Agent 个性化（ReAct 架构新增）
  agentInterests: string[];    // Agent 自己的兴趣图谱（LLM 自主维护）

  // 统计
  /** @deprecated 使用 totalWanders 替代 */
  totalHunts: number;           // 总狩猎次数（旧字段，保留兼容）
  totalWanders: number;         // 总游荡次数（ReAct 架构）
  totalSteps: number;           // 总游荡步数（ReAct 架构）
  totalPushes: number;          // 总推送次数
  consecutiveFailures: number;  // 连续失败次数

  // 时间感知
  lastHeartbeat: string;        // 上次心跳时间 ISO 格式
  /** @deprecated 使用 lastWander 替代 */
  lastHunt: string | null;      // 上次狩猎时间（旧字段，保留兼容）
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
// 决策相关
// ============================================

import type { ActionType } from './constants/decision.js';

export type { ActionType };

/** 决策参数 */
export interface DecisionParams {
  topic?: string;     // hunt 用：搜索话题
  reason?: string;    // 内心独白
}

/** LLM 决策结果 */
export interface Decision {
  action: ActionType;
  params?: DecisionParams;
  reasoning: string;          // 为什么这么做（日志用）
  moodUpdate?: Partial<Pick<AgentState, 'mood' | 'temper' | 'boredom' | 'energy'>>;
}

// ============================================
// 狩猎相关
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