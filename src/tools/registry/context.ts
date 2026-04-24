import type { AgentState, WanderStep } from '../../types.js';

/** ctx.wanderHistory 在单次游荡循环内的最大长度 */
const MAX_CTX_WANDER_HISTORY = 50;

/** Tool 执行上下文（在 Tool execute 中共享的 mutable 状态） */
export interface ToolContext {
  state: AgentState;
  stepCount: number;            // 步数计数器（每次 tool call +1）
  wanderHistory: WanderStep[];  // 游荡历史记录
  visitedUrls: string[];        // 访问过的 URL
  spokeTimes: number;           // speak 调用次数
  endReason: 'rest' | 'max_steps' | 'low_energy' | 'error';
  startTime: number;            // 游荡开始时间（ms）
}

/**
 * 向 ctx.wanderHistory 追加一条步骤记录
 * 超出上限时自动丢弃最旧的记录，防止 maxWanderSteps 调大后内存堆积
 */
export function pushWanderStep(ctx: ToolContext, step: WanderStep): void {
  ctx.wanderHistory.push(step);
  if (ctx.wanderHistory.length > MAX_CTX_WANDER_HISTORY) {
    ctx.wanderHistory.splice(0, ctx.wanderHistory.length - MAX_CTX_WANDER_HISTORY);
  }
}
