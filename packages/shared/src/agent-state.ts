/**
 * 宠物运行时状态契约：agent worker 写租户 state.json（唯一写入方），
 * CP /api/state 透传并注入最近游荡历史，web 只渲染、不再解析。
 */

import type { PetMood } from './pet-stats';

/** Agent 状态（state.json 全量字段） */
export interface AgentState {
  /** 无聊值 0-100 */
  boredom: number;
  /** 精力值 0-100 */
  energy: number;
  mood: PetMood;
  /** 脾气值 0-100（高 = 容易罢工） */
  temper: number;
  /** 固执程度 0-100（高 = 不听用户反馈） */
  stubbornness: number;
  /** 上次行动时间（ISO） */
  lastActionTime: string | null;
  /** 最近搜过的话题 */
  recentTopics: string[];
  userLikes: string[];
  userDislikes: string[];
  /** 旧兴趣字段：兴趣图谱已接管，state.json 存量数据仍含此键，agent 序列化保留 */
  agentInterests: string[];
  totalWanders: number;
  totalSteps: number;
  totalPushes: number;
  consecutiveFailures: number;
  /** 上次心跳时间（ISO） */
  lastHeartbeat: string;
  /** 上次游荡时间（ISO） */
  lastWander: string | null;
  lastRest: string | null;
}

/** 一轮游荡中的单步记录（ReAct trace） */
export interface WanderStep {
  timestamp: string;
  /** 调用的工具名 */
  tool: string;
  /** LLM 内心独白 */
  thought?: string;
  /** 访问过的 URL */
  url?: string;
  /** 调用 speak 时记录的内容 */
  spoke?: string;
}

/** /api/state 快照 = state.json + CP 注入的最近游荡历史（尾部最新、限条数） */
export interface AgentStateSnapshot extends AgentState {
  wanderHistory?: WanderStep[];
}
