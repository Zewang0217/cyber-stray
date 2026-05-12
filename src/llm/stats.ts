/**
 * LLM 调用统计模块
 *
 * 追踪 generateText 调用次数和耗时
 */

export interface LLMStats {
  calls: number;
  totalMs: number;
  avgMs: number;
}

interface CallRecord {
  startMs: number;
  endMs: number;
}

let calls: CallRecord[] = [];
let currentCall: CallRecord | null = null;

/**
 * 开始一次 LLM 调用
 */
export function startLLMCall(): void {
  currentCall = { startMs: Date.now(), endMs: 0 };
}

/**
 * 结束一次 LLM 调用
 */
export function endLLMCall(): void {
  if (currentCall) {
    currentCall.endMs = Date.now();
    calls.push(currentCall);
    currentCall = null;
  }
}

/**
 * 获取统计信息
 */
export function getLLMStats(): LLMStats {
  const totalMs = calls.reduce((sum, c) => sum + (c.endMs - c.startMs), 0);
  const avgMs = calls.length > 0 ? Math.round(totalMs / calls.length) : 0;
  return { calls: calls.length, totalMs, avgMs };
}

/**
 * 重置统计（每次 ReAct Loop 开始时调用）
 */
export function resetLLMStats(): void {
  calls = [];
  currentCall = null;
}