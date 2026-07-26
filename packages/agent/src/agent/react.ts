import { generateText, stepCountIs, hasToolCall } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';
import { consola } from '../logger.js';
import { config, getDataPath } from '../config.js';
import { updateState } from './state.js';
import { loadUserProfile } from '../memory/user-profile.js';
import { buildReactSystemPrompt, buildReactUserPrompt } from '../prompts/react.js';
import { ToolManager, type ToolContext } from '../tools/registry/index.js';
import { buildMemoryPromptContext, recordWanderSummary } from '../memory/long-term.js';
import { generateTraceId } from '../logger/trace.js';
import { resetLLMStats, getLLMStats, recordStep } from '../llm/stats.js';
import type { AgentState, WanderStep } from '../types.js';
import { getBrowserContext, buildBrowserPromptSection } from '../tools/browser/lifecycle.js';

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

/** 工具管理器初始化标志 */
let _toolsInitialized = false;

/**
 * 确保工具已初始化
 */
async function ensureToolsInitialized(): Promise<void> {
  if (!_toolsInitialized) {
    await ToolManager.initialize();
    _toolsInitialized = true;
  }
}

/**
 * 重置模块级状态（仅供测试隔离使用）
 *
 * 清除缓存的 provider 和工具初始化标志，使下一次 runAgentLoop 重新初始化，
 * 避免同一进程内多个测试之间互相污染。配合 ToolManager.reset() 使用。
 */
export function _resetReactModuleState(): void {
  _provider = null;
  _toolsInitialized = false;
}

// 消耗和恢复参数（从配置文件读取，保留硬编码默认值以便静态分析）
const ENERGY_COST_PER_STEP = config.energyCostPerStep;
const BOREDOM_REDUCTION_PER_STEP = config.boredomReductionPerStep;
/** ctx.wanderHistory 在循环内的最大长度（防止单次游荡步数过多时内存堆积） */
const MAX_WANDER_HISTORY_IN_CTX = 50;

/** CR-05：游荡历史文件名（路径走 getDataPath，尊重 DATA_DIR，测试隔离） */
const WANDER_HISTORY_FILE = 'wander-history.json';
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
      } catch (error) {
        logger.warn('忽略无效 URL，无法提取 hostname', { url: step.url, error });
      }
    }
  }

  return [...topics].slice(-10);
}

/**
 * 将本次游荡步骤追加到游荡历史日志文件
 *
 * - 走 getDataPath（尊重 DATA_DIR，测试隔离；CR-05）
 * - 原子写：temp + rename（崩溃不致半写损坏文件；CR-05，与 memory-index 同标准）
 * - 解析失败抛错（D-09：不兜底空数组吞历史；调用点已有 .catch 兜 warn 不阻断主流程）
 */
async function appendWanderHistory(steps: WanderStep[]): Promise<void> {
  const fullPath = getDataPath(WANDER_HISTORY_FILE);
  let history: WanderStep[] = [];
  if (existsSync(fullPath)) {
    const raw = await readFile(fullPath, 'utf-8');
    history = JSON.parse(raw);
  }
  history.push(...steps);
  if (history.length > MAX_WANDER_HISTORY_ENTRIES) {
    history = history.slice(-MAX_WANDER_HISTORY_ENTRIES);
  }
  const tmp = `${fullPath}.tmp`;
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(tmp, JSON.stringify(history, null, 2), 'utf-8');
  await rename(tmp, fullPath);
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
  const traceId = generateTraceId();

  // 重置 LLM 统计
  resetLLMStats();

  logger.info(`[${traceId}] LOOP 游荡开始`, {
    boredom: state.boredom,
    energy: state.energy,
    mood: state.mood,
    maxSteps,
  });

  // 初始化上下文（mutable，Tools 会修改）
  const ctx: ToolContext = {
    state,
    traceId,
    stepCount: 0,
    wanderHistory: [],
    visitedUrls: [],
    spokeTimes: 0,
    pendingFeedbackCount: 0,
    endReason: 'max_steps',
    startTime,
    searchQueries: [],
    browserContext: getBrowserContext(),
  };

  // 确保工具已初始化
  await ensureToolsInitialized();

  const userProfile = await loadUserProfile();
  const memoryContext = await buildMemoryPromptContext();
  const systemPrompt = buildReactSystemPrompt(state, userProfile, memoryContext);
  const browserSection = buildBrowserPromptSection(ctx.browserContext ?? null);
  const fullSystemPrompt = browserSection ? `${systemPrompt}\n\n${browserSection}` : systemPrompt;
  const initialUserPrompt = buildReactUserPrompt({
    state,
    userProfile,
    stepNumber: 1,
    maxSteps,
    lastToolResult: null,
    wanderHistory: [],
  });

  const provider = getProvider();
  const tools = ToolManager.getTools(ctx);

  // D-10：generateText 整体失败重试（默认 1 次，总 attempts = generateTextMaxRetries + 1）
  const maxRetries = config.generateTextMaxRetries ?? 1;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // 每次尝试的步耗时基准（A1：AI SDK v6 StepResult 无 performance.totalMs 字段，
    // 用 Date.now() 差值作为 durationMs 真值来源）
    const attemptStart = Date.now();
    try {
      await generateText({
        model: provider.chat(config.llmModel),
        temperature: config.wanderTemperature,
        system: fullSystemPrompt,
        prompt: initialUserPrompt,
        // stopWhen 接受数组：满足任一条件即终止循环
        // - hasToolCall('rest')：LLM 主动调用 rest 工具后立即停止，不再继续迭代
        // - stepCountIs(maxSteps)：达到步数上限时强制停止
        stopWhen: [hasToolCall('rest'), stepCountIs(maxSteps)],
        tools,
        // D-11：按步计数（替换旧版"包整次 generateText 算 1 次"）。
        // 一个 step = 一次 LLM 调用（含工具步与文本步），onStepFinish 在每步结束时触发。
        // ⚠ Pitfall 1：回调内抛错被 SDK 静默吞，recordStep 内部已 no-throw，
        // 这里外层再 try/catch 双重自愈，确保任何异常都不阻断主流程。
        onStepFinish({ stepNumber, usage }) {
          try {
            recordStep({
              stepNumber,
              promptTokens: usage?.inputTokens,
              completionTokens: usage?.outputTokens,
              totalTokens: usage?.totalTokens,
              durationMs: Date.now() - attemptStart,
            });
          } catch {
            // 计数自愈：不阻断主流程（recordStep 内部本就 no-throw，这里是外层兜底）
          }
        },
      });
      break; // 成功，退出重试
    } catch (error) {
      logger.error(`[${ctx.traceId}] LLM 调用异常 (attempt ${attempt + 1}/${maxRetries + 1})`, { error });
      if (attempt === maxRetries) {
        ctx.endReason = 'error';
        // CR-06：全部重试失败——仅记 consecutiveFailures，不计 totalWanders（失败不算一次成功游荡），
        // 也不进入下游状态更新/总结记录，避免把失败的游荡计入成功统计。
        await updateState({
          consecutiveFailures: state.consecutiveFailures + 1,
        }).catch((err: unknown) => logger.warn('更新 consecutiveFailures 失败', { error: err }));
        return {
          steps: 0,
          durationMs: Date.now() - startTime,
          spokeTimes: 0,
          visitedUrls: [],
          endReason: 'error',
        };
      }
    }
  }

  const durationMs = Date.now() - startTime;
  const llmStats = getLLMStats();
  // CR-03：步数以 onStepFinish 累加的 llmStats.calls 为真值（含纯文本步），与 stopWhen
  // 的 stepCountIs(maxSteps) 同源；ctx.stepCount 仅作 tool-call 计数供工具内 [Step N] 日志，
  // 不再用于状态核算（否则纯文本步不入计 → energy/boredom/totalSteps 系统性偏低）。
  const stepsTaken = llmStats.calls;

  // 汇总统计日志
  logger.info(`[${ctx.traceId}] STAT === 游荡结束 ===`, {
    steps: `${stepsTaken}/${maxSteps}`,
    durationMs,
    endReason: ctx.endReason,
    llmCalls: llmStats.calls,
    llmTotalMs: llmStats.totalMs,
    llmAvgMs: llmStats.avgMs,
    llmTotalTokens: llmStats.totalTokens,
    searchCount: ctx.searchQueries.length,
    searchQueries: ctx.searchQueries.map((s) => s.query),
    readCount: ctx.visitedUrls.length,
    readDomains: ctx.visitedUrls.map((u) => {
      try { return new URL(u).hostname; } catch { return u; }
    }),
    speakCount: ctx.spokeTimes,
  });

  // 记录游荡总结到长期记忆
  const lastSpoke = ctx.wanderHistory.filter((s) => s.spoke).pop();
  await recordWanderSummary({
    steps: stepsTaken,
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
    totalSteps: state.totalSteps + stepsTaken,
    totalPushes: state.totalPushes + ctx.spokeTimes,
    boredom: Math.max(0, state.boredom - stepsTaken * BOREDOM_REDUCTION_PER_STEP),
    energy: Math.max(0, state.energy - stepsTaken * ENERGY_COST_PER_STEP),
    recentTopics: extractRecentTopics(ctx.wanderHistory, state.recentTopics),
    consecutiveFailures: ctx.endReason === 'error' ? state.consecutiveFailures + 1 : 0,
  });

  return {
    steps: stepsTaken,
    durationMs,
    spokeTimes: ctx.spokeTimes,
    visitedUrls: ctx.visitedUrls,
    endReason: ctx.endReason,
  };
}
