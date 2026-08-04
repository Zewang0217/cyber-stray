/**
 * wanderLoop — 纯函数游荡循环
 *
 * 不 import 任何单例（config、InterestGraph、MemoryStore 全由参数注入）。
 * 只管：调 LLM → 执行工具 → emit 事件 → 返回结果。
 * 后处理（记记忆、写历史、更新状态）归 WanderAgent。
 */

import { generateText, stepCountIs, hasToolCall } from 'ai';
import type { Tool } from 'ai';
import { consola } from '../logger.js';
import { resetLLMStats, getLLMStats, recordStep } from '../llm/stats.js';
import type { EmitFn } from './events.js';
import type { ToolContext } from '../tools/registry/context.js';
import type { AgentState, WanderResult } from '../types.js';

const logger = consola.withTag('wander-loop');

/** wanderLoop 配置（由 WanderAgent 注入，不读全局 config） */
export interface WanderLoopConfig {
  maxSteps: number;
  temperature: number;
  llmModel: string;
  generateTextMaxRetries: number;
}

/** wanderLoop 输入 */
export interface WanderLoopInput {
  state: AgentState;
  config: WanderLoopConfig;
  systemPrompt: string;
  userPrompt: string;
  tools: Record<string, Tool>;
  emit: EmitFn;
  traceId: string;
  /** LLM model 实例（由 Agent 层创建注入，如 provider.chat('deepseek-chat')） */
  model: Parameters<typeof generateText>[0]['model'];
  /** 工具上下文（工具通过闭包修改，loop 结束时读取最终状态） */
  toolCtx: ToolContext;
}

/**
 * 执行一轮游荡。
 *
 * 使用 AI SDK v6 generateText + tools：
 * - LLM 自主选择 Tool 调用
 * - maxSteps 控制循环上限
 * - hasToolCall('rest') 允许 LLM 主动结束
 */
export async function wanderLoop(input: WanderLoopInput): Promise<WanderResult> {
  const { state, config, systemPrompt, userPrompt, tools, emit, traceId, model, toolCtx } = input;
  const startTime = Date.now();

  resetLLMStats();

  emit({ type: 'wander_start', traceId, maxSteps: config.maxSteps });

  logger.info(`[${traceId}] LOOP 游荡开始`, {
    boredom: state.boredom,
    energy: state.energy,
    mood: state.mood,
    maxSteps: config.maxSteps,
  });

  // D-10：generateText 整体失败重试
  const maxRetries = config.generateTextMaxRetries;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attemptStart = Date.now();
    try {
      const result = await generateText({
        model,
        temperature: config.temperature,
        system: systemPrompt,
        prompt: userPrompt,
        stopWhen: [hasToolCall('rest'), stepCountIs(config.maxSteps)],
        tools,
        onStepFinish({ stepNumber, usage, toolCalls }) {
          try {
            recordStep({
              stepNumber,
              promptTokens: usage?.inputTokens,
              completionTokens: usage?.outputTokens,
              totalTokens: usage?.totalTokens,
              durationMs: Date.now() - attemptStart,
            });
          } catch {
            // 计数自愈：不阻断主流程
          }

          // 步级事件：action = 本步调用的工具名（逗号分隔），无工具则为 'text_only'
          const action = toolCalls && toolCalls.length > 0
            ? toolCalls.map((tc) => tc.toolName).join(',')
            : 'text_only';
          emit({ type: 'step_end', step: stepNumber, action });
        },
      });

      // 记录 LLM 最终输出（用于复盘：为什么不调工具、为什么提前结束）
      const finalText = result?.text?.slice(0, 500) ?? '';
      const toolCallCount = result?.toolCalls?.length ?? 0;
      logger.info(`[${traceId}] LLM 输出 [steps=${result?.steps?.length ?? 0} toolCalls=${toolCallCount} stopReason=${result?.finishReason}]`, {
        text: finalText || '(empty)',
        toolCalls: result?.toolCalls?.map((tc) => tc.toolName) ?? [],
      });

      break; // 成功，退出重试
    } catch (error) {
      logger.error(`[${traceId}] LLM 调用异常 (attempt ${attempt + 1}/${maxRetries + 1})`, { error });
      if (attempt === maxRetries) {
        emit({ type: 'error', phase: 'llm_call', error: String(error), recoverable: false });
        const errorResult: WanderResult = {
          steps: 0,
          durationMs: Date.now() - startTime,
          spokeTimes: 0,
          visitedUrls: [],
          endReason: 'error',
        };
        emit({ type: 'wander_end', result: errorResult });
        return errorResult;
      }
    }
  }

  const durationMs = Date.now() - startTime;
  const llmStats = getLLMStats();
  const stepsTaken = llmStats.calls;

  // 从 toolCtx 读取最终状态（工具通过闭包修改）
  let endReason = toolCtx.endReason;

  // 修正：LLM 未调 rest 也未达 maxSteps 就停了（纯文本输出或 stopReason=stop）
  if (endReason === 'max_steps' && stepsTaken < config.maxSteps) {
    endReason = 'early_stop';
  }

  logger.info(`[${traceId}] STAT === 游荡结束 ===`, {
    steps: `${stepsTaken}/${config.maxSteps}`,
    durationMs,
    endReason,
    llmCalls: llmStats.calls,
    llmTotalMs: llmStats.totalMs,
    llmAvgMs: llmStats.avgMs,
    llmTotalTokens: llmStats.totalTokens,
  });

  const result: WanderResult = {
    steps: stepsTaken,
    durationMs,
    spokeTimes: toolCtx.spokeTimes,
    visitedUrls: toolCtx.visitedUrls,
    endReason,
  };

  emit({ type: 'wander_end', result });
  return result;
}
