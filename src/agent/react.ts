import { generateText, stepCountIs, hasToolCall } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { consola } from '../logger.js';
import { config } from '../config.js';
import { updateState } from './state.js';
import { loadUserProfile } from '../memory/user-profile.js';
import { buildReactSystemPrompt, buildReactUserPrompt } from '../prompts/react.js';
import { createTools, type ToolContext } from '../tools/registry/index.js';
import { buildMemoryPromptContext, recordWanderSummary } from '../memory/long-term.js';
import type { AgentState, WanderStep } from '../types.js';

const logger = consola.withTag('react');

/** 游荡统计结果 */
export interface WanderResult {
  steps: number;          // 本次游荡步数
  durationMs: number;     // 游荡时长（毫秒）
  spokeTimes: number;     // 调用 speak 的次数
  visitedUrls: string[];  // 访问过的 URL
  endReason: 'rest' | 'max_steps' | 'low_energy' | 'error';
}

function createProvider() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('缺少环境变量 DEEPSEEK_API_KEY');
  }
  // 使用官方 @ai-sdk/deepseek provider，原生处理 reasoning_content 多轮传递
  return createDeepSeek({ apiKey });
}

// null 表示未初始化；若首次调用时抛出（缺少 API key），保持 null，下次调用重试
let _provider: ReturnType<typeof createProvider> | null = null;

function getProvider() {
  if (!_provider) {
    _provider = createProvider();
  }
  return _provider;
}

/** 每游荡一步减少的无聊值 */
const BOREDOM_REDUCTION_PER_STEP = 5;
/** 每游荡一步消耗的精力值 */
const ENERGY_COST_PER_STEP = 3;
/** ctx.wanderHistory 在循环内的最大长度（防止单次游荡步数过多时内存堆积） */
const MAX_WANDER_HISTORY_IN_CTX = 50;

const WANDER_HISTORY_PATH = 'data/wander-history.json';
const MAX_WANDER_HISTORY_ENTRIES = 100;

/**
 * 从游荡步骤中提取话题关键词，用于去重提示
 */
function extractRecentTopics(steps: WanderStep[], existingTopics: string[]): string[] {
  const topics = new Set(existingTopics);

  for (const step of steps) {
    // 从搜索步骤提取 query
    if (step.tool === 'search_web' && step.thought) {
      const match = step.thought.match(/搜索\((?:free|premium)\):\s*(.+)/);
      if (match?.[1]) {
        topics.add(match[1]);
      }
    }
    // 从访问的 URL 提取域名
    if (step.url) {
      try {
        topics.add(new URL(step.url).hostname);
      } catch {
        // 忽略无效 URL
      }
    }
  }

  return [...topics].slice(-10);
}

/**
 * 将本次游荡步骤追加到游荡历史日志文件
 */
async function appendWanderHistory(steps: WanderStep[]): Promise<void> {
  try {
    let history: WanderStep[] = [];
    if (existsSync(WANDER_HISTORY_PATH)) {
      const raw = await readFile(WANDER_HISTORY_PATH, 'utf-8');
      history = JSON.parse(raw);
    }
    history.push(...steps);
    if (history.length > MAX_WANDER_HISTORY_ENTRIES) {
      history = history.slice(-MAX_WANDER_HISTORY_ENTRIES);
    }
    await writeFile(WANDER_HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
  } catch (err) {
    logger.warn('写入游荡历史日志失败', { error: err });
  }
}

/**
 * ReAct Agent 主循环
 *
 * 使用 Vercel AI SDK v6 generateText + tools 实现：
 * - LLM 自主选择 Tool 调用
 * - maxSteps 控制循环上限
 * - 精力/连续失败等条件触发强制结束
 */
export async function runAgentLoop(state: AgentState): Promise<WanderResult> {
  const startTime = Date.now();
  const maxSteps = config.maxWanderSteps;

  logger.info('ReAct Loop 启动', {
    boredom: state.boredom,
    energy: state.energy,
    mood: state.mood,
    maxSteps,
  });

  // 初始化上下文（mutable，Tools 会修改）
  const ctx: ToolContext = {
    state,
    stepCount: 0,
    wanderHistory: [],
    visitedUrls: [],
    spokeTimes: 0,
    endReason: 'max_steps',
    startTime,
  };

  const userProfile = await loadUserProfile();
  const memoryContext = await buildMemoryPromptContext();
  const systemPrompt = buildReactSystemPrompt(state, userProfile, memoryContext);
  const initialUserPrompt = buildReactUserPrompt({
    state,
    userProfile,
    stepNumber: 1,
    maxSteps,
    lastToolResult: null,
    wanderHistory: [],
  });

  const provider = getProvider();
  const tools = createTools(ctx);

  try {
    await generateText({
      model: provider.chat(config.llmModel),
      temperature: config.wanderTemperature,
      system: systemPrompt,
      prompt: initialUserPrompt,
      // stopWhen 接受数组：满足任一条件即终止循环
      // - hasToolCall('rest')：LLM 主动调用 rest 工具后立即停止，不再继续迭代
      // - stepCountIs(maxSteps)：达到步数上限时强制停止
      stopWhen: [hasToolCall('rest'), stepCountIs(maxSteps)],
      tools,
    });
  } catch (error) {
    logger.error('ReAct Loop 执行异常', { error });
    ctx.endReason = 'error';
  }

  const durationMs = Date.now() - startTime;

logger.info('ReAct Loop 结束', {
    steps: ctx.stepCount,
    durationMs,
    spokeTimes: ctx.spokeTimes,
    visitedUrls: ctx.visitedUrls.length,
    endReason: ctx.endReason,
  });

  // 记录游荡总结到长期记忆
  const lastSpoke = ctx.wanderHistory.filter((s) => s.spoke).pop();
  await recordWanderSummary({
    steps: ctx.stepCount,
    topics: ctx.wanderHistory
      .filter((s) => s.url)
      .map((s) => s.url || '')
      .filter(Boolean),
    spoke: lastSpoke?.spoke || '（本次未分享）',
    duration: durationMs,
  }).catch((err: unknown) => logger.warn('记录游荡总结失败', { error: err }));

  // 游荡历史写入独立日志文件
  await appendWanderHistory(ctx.wanderHistory).catch(
    (err: unknown) => logger.warn('写入游荡历史日志失败', { error: err }),
  );

  // 更新状态（含 recentTopics 用于跨游荡去重提示）
  await updateState({
    lastWander: new Date().toISOString(),
    totalWanders: state.totalWanders + 1,
    totalSteps: state.totalSteps + ctx.stepCount,
    totalPushes: state.totalPushes + ctx.spokeTimes,
    boredom: Math.max(0, state.boredom - ctx.stepCount * BOREDOM_REDUCTION_PER_STEP),
    energy: Math.max(0, state.energy - ctx.stepCount * ENERGY_COST_PER_STEP),
    recentTopics: extractRecentTopics(ctx.wanderHistory, state.recentTopics),
    consecutiveFailures: ctx.endReason === 'error' ? state.consecutiveFailures + 1 : 0,
  });

  return {
    steps: ctx.stepCount,
    durationMs,
    spokeTimes: ctx.spokeTimes,
    visitedUrls: ctx.visitedUrls,
    endReason: ctx.endReason,
  };
}
