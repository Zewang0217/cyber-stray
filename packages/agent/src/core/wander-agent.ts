/**
 * WanderAgent — 状态层
 *
 * 持有游荡所需的状态和依赖，负责：
 * 1. 生成游荡策略（Wave 1：硬编码当前值，行为不变）
 * 2. 构建 prompt（调用 prompts/react.ts）
 * 3. 创建 ToolContext + 获取工具 + hook 包装
 * 4. 调用 wanderLoop 纯函数
 * 5. 后处理（记记忆、写历史、更新状态）
 *
 */

import { createDeepSeek, type DeepSeekProvider } from '@ai-sdk/deepseek';
import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';
import { consola } from '../logger.js';
import { config, getDataPath } from '../config.js';
import { updateState } from '../agent/state.js';
import { loadUserProfile } from '../memory/user-profile.js';
import { buildReactSystemPrompt, buildReactUserPrompt } from '../prompts/react.js';
import { ToolManager } from '../tools/tool-manager.js';
import type { ToolContext } from '../tools/registry/context.js';
import { buildMemoryPromptContext, recordWanderSummary } from '../memory/long-term.js';
import { generateTraceId } from '../logger/trace.js';
import { WanderEventEmitter } from './events.js';
import type { WanderEvent } from './events.js';
import { wanderLoop } from './wander-loop.js';
import type { WanderLoopConfig } from './wander-loop.js';
import { HookChain } from '../hooks/chain.js';
import type { HookContext } from '../hooks/types.js';
import { getInterestGraph } from '../memory/interest-graph.js';
import type { AgentState, AgentConfig, WanderResult, WanderStep, WanderStrategy } from '../types.js';

const logger = consola.withTag('wander-agent');

/** 消耗和恢复参数 */
const ENERGY_COST_PER_STEP = config.energyCostPerStep;
const BOREDOM_REDUCTION_PER_STEP = config.boredomReductionPerStep;

/** 游荡历史文件 */
const WANDER_HISTORY_FILE = 'wander-history.json';
const MAX_WANDER_HISTORY_ENTRIES = 100;

export class WanderAgent {
  private emitter = new WanderEventEmitter();
  private hookChain = new HookChain();
  private hooksReady = false;

  // Provider 缓存
  private _provider: DeepSeekProvider | null = null;

  constructor(private readonly agentConfig: AgentConfig = config) {}

  /** 订阅游荡事件（Harness、TUI、日志用） */
  onEvent(listener: (event: WanderEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => { this.emitter.off('event', listener); };
  }

  /** 初始化 hooks + 工具注册（首次 wander 前调用） */
  async initHooks(disabledNames?: string[]): Promise<void> {
    if (this.hooksReady) return;
    await ToolManager.initialize();
    await this.hookChain.init(disabledNames);
    this.hooksReady = true;
  }

  /** 执行一次游荡 */
  async wander(state: AgentState): Promise<WanderResult> {
    await this.initHooks();

    const traceId = generateTraceId();

    // 1. 生成策略（兴趣驱动 + 状态映射）
    const strategy = this.buildStrategy(state);
    logger.info(`[${traceId}] 游荡策略`, {
      focusTopics: strategy.focusTopics,
      explorationMode: strategy.explorationMode,
      maxSteps: strategy.maxSteps,
      speakInclination: strategy.speakInclination,
    });

    // 2. 构建 prompt
    const userProfile = await loadUserProfile();
    const memoryContext = await buildMemoryPromptContext();
    const systemPrompt = buildReactSystemPrompt(state, userProfile, memoryContext, strategy);
    const initialUserPrompt = buildReactUserPrompt({
      state,
      userProfile,
      stepNumber: 1,
      maxSteps: strategy.maxSteps,
      lastToolResult: null,
      wanderHistory: [],
    });

    // 3. 创建 ToolContext
    const toolCtx: ToolContext = {
      state,
      traceId,
      stepCount: 0,
      wanderHistory: [],
      visitedUrls: [],
      spokeTimes: 0,
      pendingFeedbackCount: 0,
      endReason: 'max_steps',
      startTime: Date.now(),
      searchQueries: [],
    };

    // 4. 获取工具 + hook 包装
    const rawTools = ToolManager.getTools(toolCtx);
    const hookCtx: HookContext = {
      traceId,
      state,
      config: this.agentConfig,
      emit: (e) => this.emitter.emitEvent(e),
      toolCtx,
      data: {},
    };
    const tools = this.hookChain.wrapTools(rawTools, hookCtx);

    // 5. 执行 onWanderStart hooks
    await this.hookChain.runWanderStart(hookCtx);

    // 6. 调 wanderLoop
    const loopConfig: WanderLoopConfig = {
      maxSteps: strategy.maxSteps,
      temperature: this.agentConfig.wanderTemperature,
      llmModel: this.agentConfig.llmModel,
      generateTextMaxRetries: this.agentConfig.generateTextMaxRetries ?? 1,
    };

    const result = await wanderLoop({
      state,
      config: loopConfig,
      systemPrompt,
      userPrompt: initialUserPrompt,
      tools,
      emit: (e) => this.emitter.emitEvent(e),
      traceId,
      model: this.getProvider().chat(this.agentConfig.llmModel),
      toolCtx,
    });

    // 7. 执行 onWanderEnd hooks
    await this.hookChain.runWanderEnd(hookCtx, result);

    // 8. 后处理
    await this.postWander(state, result, toolCtx);

    return result;
  }

  // ─── Private ───

  /**
   * 生成游荡策略：兴趣图谱 → 聚焦话题，状态 → 行为参数。
   *
   * 硬映射：
   * - 精力 > 70 → maxSteps=12, 不限探索模式
   * - 精力 30-70 → maxSteps=8
   * - 精力 < 30 → maxSteps=4, 强制 deep（不探索新领域）
   * - 无聊 > 80 → novel（强制搜新领域）
   * - 无聊 40-80 → broad
   * - 无聊 < 40 → deep
   */
  private buildStrategy(state: AgentState): WanderStrategy {
    // ─── 兴趣 → 聚焦话题 ───
    let focusTopics: string[] = [];
    try {
      const graph = getInterestGraph();
      const topInterests = graph.getTopInterestsWithWeights(3, 0.05);
      focusTopics = topInterests.map((i) => i.id);
    } catch {
      // InterestGraph 不可用时 fallback 到 state.agentInterests
      focusTopics = state.agentInterests.slice(0, 3);
    }

    // ─── 精力 → maxSteps（按 config.maxWanderSteps 比例缩放）───
    const ceiling = this.agentConfig.maxWanderSteps;
    let maxSteps: number;
    if (state.energy > 70) {
      maxSteps = ceiling;
    } else if (state.energy >= 30) {
      maxSteps = Math.round(ceiling * 0.6);
    } else {
      maxSteps = Math.round(ceiling * 0.2);
    }

    // ─── 无聊 → explorationMode ───
    let explorationMode: WanderStrategy['explorationMode'];
    if (state.boredom > 80) {
      explorationMode = 'novel';
    } else if (state.boredom >= 40) {
      explorationMode = 'broad';
    } else {
      explorationMode = 'deep';
    }

    // 精力过低时强制 deep（不探索新领域，节省精力）
    if (state.energy < 30) {
      explorationMode = 'deep';
    }

    // ─── 心情 → speakInclination ───
    let speakInclination: WanderStrategy['speakInclination'] = 'normal';
    if (state.mood === 'excited' || state.mood === 'playful') {
      speakInclination = 'high';
    } else if (state.mood === 'lazy' || state.mood === 'emo') {
      speakInclination = 'low';
    }

    // ─── 硬约束 ───
    const constraints: string[] = [];
    if (focusTopics.length > 0) {
      constraints.push(`本次游荡的前 3 步搜索中，至少有一次必须围绕"${focusTopics[0]}"展开`);
    }
    if (explorationMode === 'novel') {
      constraints.push('你今天特别想探索没见过的领域，优先搜索之前没搜过的话题');
    }
    if (explorationMode === 'deep' && focusTopics.length > 0) {
      constraints.push(`今天深耕"${focusTopics[0]}"，多角度搜索、多点进链接深读`);
    }

    return { focusTopics, explorationMode, maxSteps, speakInclination, constraints };
  }

  private getProvider() {
    if (!this._provider) {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        throw new Error('缺少环境变量 DEEPSEEK_API_KEY');
      }
      this._provider = createDeepSeek({ apiKey });
    }
    return this._provider;
  }

  /** 后处理：记记忆、写历史、更新状态 */
  private async postWander(state: AgentState, result: WanderResult, ctx: ToolContext): Promise<void> {
    // 汇总统计日志
    logger.info(`[${ctx.traceId}] 游荡后处理`, {
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
      steps: result.steps,
      topics: ctx.wanderHistory
        .filter((s) => s.url)
        .map((s) => s.url || '')
        .filter(Boolean),
      spoke: lastSpoke?.spoke || '（本次未分享）',
      duration: result.durationMs,
    }).catch((err: unknown) => logger.warn('记录游荡总结失败', { error: err }));

    // 游荡历史写入独立日志文件
    await this.appendWanderHistory(ctx.wanderHistory).catch(
      (err: unknown) => logger.warn('写入游荡历史日志失败', { error: err }),
    );

    // 更新状态
    await updateState({
      lastWander: new Date().toISOString(),
      totalWanders: state.totalWanders + 1,
      totalSteps: state.totalSteps + result.steps,
      totalPushes: state.totalPushes + ctx.spokeTimes,
      boredom: Math.max(0, state.boredom - result.steps * BOREDOM_REDUCTION_PER_STEP),
      energy: Math.max(0, state.energy - result.steps * ENERGY_COST_PER_STEP),
      recentTopics: this.extractRecentTopics(ctx.wanderHistory, state.recentTopics),
      consecutiveFailures: result.endReason === 'error' ? state.consecutiveFailures + 1 : 0,
    });
  }

  /** 从游荡步骤中提取话题关键词，用于去重提示 */
  private extractRecentTopics(steps: WanderStep[], existingTopics: string[]): string[] {
    const topics = new Set(existingTopics);
    for (const step of steps) {
      if (step.tool === 'search_web' && step.thought) {
        const match = step.thought.match(/搜索\((?:free|premium)\):\s*(.+)/);
        if (match?.[1]) topics.add(match[1]);
      }
      if (step.url) {
        try { topics.add(new URL(step.url).hostname); } catch { /* ignore */ }
      }
    }
    return [...topics].slice(-10);
  }

  /** 将本次游荡步骤追加到游荡历史日志文件 */
  private async appendWanderHistory(steps: WanderStep[]): Promise<void> {
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
}
