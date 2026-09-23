/**
 * Agent 运行时类型：跨包契约（状态 / 游荡步骤 / 心情）从 shared 转发；
 * 其余为 agent 内部形状（搜索结果 / 反馈 / 配置 / 密钥 / 套餐参数 / 日志）。
 */

import type { Catchphrase, PersonalityId } from '@cyber-stray/shared';
import type { PetMood, WanderStatsReport } from '@cyber-stray/shared/pet-stats';

/** Agent 心情类型（枚举真相源在 shared/pet-stats） */
export type Mood = PetMood;

/** 状态与游荡步骤契约在 shared/agent-state（CP 透传、web 渲染同源） */
export type { AgentState, WanderStep } from '@cyber-stray/shared/agent-state';

/** 游荡统计结果 */
export interface WanderResult {
  steps: number;          // 本次游荡步数
  durationMs: number;     // 游荡时长（毫秒）
  spokeTimes: number;     // 调用 speak 的次数
  visitedUrls: string[];  // 访问过的 URL
  endReason: 'rest' | 'max_steps' | 'early_stop' | 'error';
  /** 游荡结束数值（ADR-0013 写回：worker 按实际步数算好交 CP 落库；error 路径无） */
  stats?: WanderStatsReport;
}

/** 游荡策略（由兴趣图谱 + 状态生成，注入 prompt） */
export interface WanderStrategy {
  focusTopics: string[];
  explorationMode: 'deep' | 'broad' | 'novel';
  maxSteps: number;
  speakInclination: 'high' | 'normal' | 'low';
  constraints: string[];
}

/** 搜索结果（工具内部形状） */
export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

/** 反馈类型 */
export type FeedbackType = 'like' | 'dislike';

/** 用户反馈 */
export interface Feedback {
  type: FeedbackType;
  topic: string;
  contentId: string;    // 推送内容标识（URL hash）
  timestamp: string;
}


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

/** 套餐执行参数（控制面调度器注入；worker 短命进程内存态） */
export interface PlanExecutionArgs {
  plan: 'free' | 'pro' | 'byok';
  /** 每日推送上限（gate 放行 speak 落盘数；0 = 不限） */
  pushesPerDay: number;
  /** 推送时间窗（本地小时 0-23；null = 全天可推） */
  pushWindowStart: number | null;
  pushWindowEnd: number | null;
  /**
   * 单轮游荡整体预算 ms（CP 下发 workerTimeout − 余量；含重试在内，
   * 超时优雅退出走错误路径，而非被 CP SIGKILL 硬杀丢写回）。undefined =
   * 不设限（单用户模式——超时护栏只承诺多租户调度路径）。
   */
  llmTimeoutMs?: number;
  /**
   * 首推模式（CP 按 lastRunAt == null 判定的第一次游荡）。prompt 注入
   * 「必须产出首推」上下文——不豁免质量自判断与护栏，只把“可沉默”偏置成“必产出”。
   */
  firstPush?: boolean;
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

  // ReAct Loop 配置
  maxWanderSteps: number;        // 每次游荡最大步数（安全上限）
  wanderTemperature: number;     // 游荡 LLM 温度（高随机性）

  /** 性格（认领时选择；好奇=基准；控制面经 worker CLI 注入） */
  personality: PersonalityId;
  /** 口头禅（worker CLI 注入的当前有效集合；缺省 = 性格默认组） */
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

  // LLM 调用容错配置（generateText 整体失败重试次数）
  generateTextMaxRetries: number;  // 重试次数（总 attempts = 此值 + 1）

  // 记忆合并/清理阈值（外置到 agent-config.json；默认值由 config.ts defaultBehavior 提供）
  consolidation?: {
    lowImportanceThreshold: number;
    expiryDays: number;
    mergeMaxAgeDays: number;
    urlCleanupDays: number;
  };

  // 兴趣图谱配置
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

  // 推送护栏配置：评分门控已移除，speak 由 LLM 自判断；键名沿用
  // pushGate——已部署在各租户 agent-config.json，改名破坏存量
  pushGate?: {
    enabled: boolean;
    /** 每次游荡最多 speak 次数（工具层护栏，防话痨；0 = 不限） */
    maxSpeaksPerWander: number;
    contentScan: {
      enabled: boolean;
      maxUrlCount: number;
    };
  };

  // Hook 系统配置
  hooks?: {
    /** 禁用的 hook 名称列表（如 ["quality"]） */
    disabled?: string[];
  };

  /** 每租户敏感信息（由 loadConfig 注入；单用户模式为空对象，回退环境变量） */
  secrets?: AgentSecrets;
  /** 套餐执行参数（控制面注入门控；未注入 = 单用户模式不设限） */
  plan?: PlanExecutionArgs;
}

/** 日志级别 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 日志条目 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}