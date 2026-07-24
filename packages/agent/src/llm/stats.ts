/**
 * LLM 调用统计模块（按步累加）
 *
 * 由 AI SDK v6 generateText 的 onStepFinish 回调驱动：
 * 每完成一个 step（含工具步与文本步）就调一次 recordStep，getLLMStats 返回真实步数。
 *
 * 取代旧版"把整次 generateText 包装成一次"的统计方式（旧版在 maxSteps>1 的多步
 * ReAct loop 中 calls 恒为 1，严重失真）。
 *
 * 关键约束（RESEARCH Pitfall 1）：onStepFinish 回调内抛错会被 SDK 静默吞掉，
 * 因此 recordStep 内部必须 no-throw——任何异常在内部 catch 掉，
 * 用安全默认值兜底内部状态，但绝不向上抛。
 */

/** LLM 调用聚合统计结果 */
export interface LLMStats {
  /** 累计步数（= recordStep 调用次数，一个 step = 一次 LLM 调用） */
  calls: number;
  /** 所有步耗时之和（毫秒） */
  totalMs: number;
  /** 平均每步耗时（毫秒，四舍五入） */
  avgMs: number;
  /** 所有步 token 总数 */
  totalTokens: number;
}

/** 单步记录（由 onStepFinish 回调传入） */
export interface StepRecord {
  /** 步号（AI SDK 的 stepNumber 从 0 开始） */
  stepNumber: number;
  /** 输入 token 数（可选，provider 不返回则为 undefined） */
  promptTokens?: number;
  /** 输出 token 数（可选） */
  completionTokens?: number;
  /** 总 token 数（可选） */
  totalTokens?: number;
  /** 本步耗时（毫秒） */
  durationMs: number;
}

let steps: StepRecord[] = [];

/**
 * 记录一步（由 onStepFinish 回调调用）
 *
 * no-throw：即使收到非法输入（null / 缺字段），也用安全默认值填充内部状态，
 * 绝不向上抛（回调内抛错被 SDK 静默吞，会静默丢步且无日志）。
 */
export function recordStep(rec: StepRecord): void {
  try {
    steps.push({
      stepNumber: typeof rec?.stepNumber === 'number' ? rec.stepNumber : 0,
      durationMs: typeof rec?.durationMs === 'number' ? rec.durationMs : 0,
      totalTokens: typeof rec?.totalTokens === 'number' ? rec.totalTokens : 0,
      promptTokens: typeof rec?.promptTokens === 'number' ? rec.promptTokens : undefined,
      completionTokens: typeof rec?.completionTokens === 'number' ? rec.completionTokens : undefined,
    });
  } catch {
    // 计数自愈：回调内异常被 SDK 静默吞，这里 catch 后不抛、不记日志（避免循环调用 logger）
  }
}

/**
 * 获取累计统计信息
 */
export function getLLMStats(): LLMStats {
  const calls = steps.length;
  const totalMs = steps.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
  const totalTokens = steps.reduce((sum, r) => sum + (r.totalTokens ?? 0), 0);
  const avgMs = calls > 0 ? Math.round(totalMs / calls) : 0;
  return { calls, totalMs, avgMs, totalTokens };
}

/**
 * 重置统计（每次 ReAct Loop 开始时调用）
 */
export function resetLLMStats(): void {
  steps = [];
}
