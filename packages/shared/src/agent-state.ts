/**
 * 宠物运行时状态契约：agent worker 写租户 state.json（唯一写入方），
 * CP /api/state 透传并注入最近游荡历史，web 只渲染、不再解析。
 */

import { z } from 'zod';
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

/** 游荡步骤的呈现状态；缺省 = 正常 */
export const WanderStepStatusSchema = z.enum(['failed', 'blocked']);
export type WanderStepStatus = z.infer<typeof WanderStepStatusSchema>;

/** 一轮游荡中的单步记录（ReAct trace）。schema 即契约，类型由 z.infer 派生（禁镜像） */
export const WanderStepSchema = z.object({
  timestamp: z.string(),
  /** 调用的工具名 */
  tool: z.string(),
  /** LLM 内心独白 */
  thought: z.string().optional(),
  /** 访问过的 URL */
  url: z.string().optional(),
  /** 调用 speak 时记录的内容 */
  spoke: z.string().optional(),
  /** 所在巷子（宠物自命名，经巷子清单归一；未上报时沿用本游荡上一步） */
  alley: z.string().optional(),
  /** 一句话站名，工具层确定性填写（搜索词 / 页面标题 / 知识标题 / 叼回标题） */
  title: z.string().optional(),
  /** 失败 / 被护栏拦截；由工具与 hook 的确定性分支填写，呈现层不做文本猜测 */
  status: WanderStepStatusSchema.optional(),
});
export type WanderStep = z.infer<typeof WanderStepSchema>;

/** /api/state 快照 = state.json + CP 注入的最近游荡历史（尾部最新、限条数） */
export interface AgentStateSnapshot extends AgentState {
  wanderHistory?: WanderStep[];
}
