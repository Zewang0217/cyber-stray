import type { AgentState, WanderStep } from '../../types.js';
import type { BrowserContext } from '../browser/lifecycle.js';
import { resolveAlley } from '../../memory/alleys.js';

/** ctx.wanderHistory 在单次游荡循环内的最大长度 */
const MAX_CTX_WANDER_HISTORY = 50;

/** 搜索记录 */
export interface SearchRecord {
  query: string;
  quality: 'free' | 'premium';
  timestamp: string;
}

/** Tool 执行上下文（在 Tool execute 中共享的 mutable 状态） */
export interface ToolContext {
  state: AgentState;
  traceId: string;              // 本次游荡的唯一追踪 ID
  stepCount: number;            // 步数计数器（每次 tool call +1）
  wanderHistory: WanderStep[];  // 游荡历史记录
  visitedUrls: string[];        // 访问过的 URL
  spokeTimes: number;           // speak 调用次数
  pendingFeedbackCount: number; // 待处理反馈数量（read_feedback 工具设置）
  endReason: 'rest' | 'max_steps' | 'early_stop' | 'error';
  startTime: number;            // 游荡开始时间（ms）
  searchQueries: SearchRecord[]; // 搜索词归档
  /** 浏览器上下文（无浏览器时为 null） */
  browserContext?: BrowserContext | null;
  /** quality hook 写入：本次 speak 门控理由（推送理由，随推送历史落盘） */
  gateReasons?: string[];
  /** quality hook 写入：本次 speak 门控实际命中的兴趣话题（反馈归因用，未评估/失败时为 undefined） */
  matchedTopics?: string[];
  /** 当前所在巷子（LLM 上报经 alley 清单归一；后续步骤缺省沿用） */
  currentAlley?: string;
}

/**
 * 归一 LLM 上报的巷子名并更新 ctx.currentAlley（各工具 execute 开头调用）。
 * raw 为空时沿用当前巷子。
 */
export async function applyAlley(ctx: ToolContext, raw?: string): Promise<string | undefined> {
  ctx.currentAlley = await resolveAlley(raw, ctx.currentAlley);
  return ctx.currentAlley;
}

/**
 * 向 ctx.wanderHistory 追加一条步骤记录
 * 超出上限时自动丢弃最旧的记录，防止 maxWanderSteps 调大后内存堆积
 */
export function pushWanderStep(ctx: ToolContext, step: WanderStep): void {
  // 未显式携带巷子时沿用当前巷子——rest / read_feedback 等无 alley 入参的工具
  // 也落在上一步的泳道里
  if (!step.alley && ctx.currentAlley) step.alley = ctx.currentAlley;
  ctx.wanderHistory.push(step);
  if (ctx.wanderHistory.length > MAX_CTX_WANDER_HISTORY) {
    ctx.wanderHistory.splice(0, ctx.wanderHistory.length - MAX_CTX_WANDER_HISTORY);
  }
}
