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
import { computeStrategy } from './strategy.js';
import { pickFocusTopics } from './personality.js';
import type { WanderLoopConfig } from './wander-loop.js';
import { HookChain } from '../hooks/chain.js';
import type { HookContext } from '../hooks/types.js';
import { getInterestGraph } from '../memory/interest-graph.js';
import {
  getBrowserContext,
  buildBrowserPromptSection,
} from '../tools/browser/lifecycle.js';
import type { AgentState, AgentConfig, WanderResult, WanderStep, WanderStrategy } from '../types.js';

const logger = consola.withTag('wander-agent');


/** 游荡历史文件 */
const WANDER_HISTORY_FILE = 'wander-history.json';
const MAX_WANDER_HISTORY_ENTRIES = 100;

/** 兴趣回灌：已存在兴趣每次游荡的强化增量（0-1 权重域） */
const WANDER_REINFORCE_DELTA = 0.12;
/** 兴趣回灌：新话题的初始权重（novelty 预算会钳低） */
const WANDER_NEW_INTEREST_WEIGHT = 0.2;

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
    // RFC #59 §4：配置禁用链路（agent-config.json 的 hooks.disabled）
    this.hookChain.init(disabledNames ?? this.agentConfig.hooks?.disabled);
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
    let systemPrompt = buildReactSystemPrompt(state, userProfile, memoryContext, strategy);
    // 浏览器上下文（跨游荡持久，无浏览器时为 null）→ 追加注入 system prompt
    const browserContext = getBrowserContext();
    const browserSection = buildBrowserPromptSection(browserContext ?? null);
    if (browserSection) {
      systemPrompt = `${systemPrompt}\n\n${browserSection}`;
    }
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
      browserContext,
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

    // 8. CR-06：LLM 全部重试失败——仅记 consecutiveFailures，不计 totalWanders，
    // 不写总结、不扣精力（失败的游荡不算一次成功游荡）
    if (result.endReason === 'error') {
      await updateState({
        consecutiveFailures: state.consecutiveFailures + 1,
      }).catch((err: unknown) => logger.warn('更新 consecutiveFailures 失败', { error: err }));
      return result;
    }

    // 9. 后处理
    await this.postWander(state, result, toolCtx);

    return result;
  }

  // ─── Private ───

  /**
   * 生成游荡策略：兴趣图谱 → 聚焦话题，状态 → 行为参数。
   * 映射规则见 core/strategy.ts（computeStrategy，纯函数可测）；
   * #90 性格探索倾向见 core/personality.ts（pickFocusTopics，纯函数可测）——
   * 候选取 top-8 再按性格新/旧话题权重混合打分，好奇偏新、慵懒偏熟。
   */
  private buildStrategy(state: AgentState): WanderStrategy {
    // ─── 兴趣 → 聚焦话题（候选放宽到 8，性格权重定最终 3）───
    let focusTopics: string[] = [];
    try {
      const graph = getInterestGraph();
      const candidates = graph.getTopInterestsWithWeights(8, 0.05);
      focusTopics = pickFocusTopics(candidates, this.agentConfig.personality, 3);
    } catch (err) {
      // InterestGraph 不可用时 fallback 到 state.agentInterests（显式 warn，不静默降级）
      logger.warn('InterestGraph 查询失败，fallback 到 state.agentInterests', { error: String(err) });
      focusTopics = state.agentInterests.slice(0, 3);
    }

    return computeStrategy(state, this.agentConfig.maxWanderSteps, focusTopics);
  }

  private getProvider() {
    if (!this._provider) {
      // per-tenant secrets 优先，回退进程环境变量（单用户模式）。
      // BYOK：config.ts 组装时已把回退挡掉（secrets.deepseekApiKey 为
      // undefined）——这里 ?? env 会重新开漏字口，必须按 plan 再挡一次
      const apiKey =
        this.agentConfig.plan?.plan === 'byok'
          ? this.agentConfig.secrets?.deepseekApiKey
          : (this.agentConfig.secrets?.deepseekApiKey ?? process.env.DEEPSEEK_API_KEY);
      if (!apiKey) {
        throw new Error(
          this.agentConfig.plan?.plan === 'byok'
            ? 'BYOK 套餐缺少自有 DeepSeek API key（请在设置页绑定）'
            : '缺少环境变量 DEEPSEEK_API_KEY',
        );
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
      boredom: Math.max(0, state.boredom - result.steps * this.agentConfig.boredomReductionPerStep),
      energy: Math.max(0, state.energy - result.steps * this.agentConfig.energyCostPerStep),
      recentTopics: this.extractRecentTopics(ctx.wanderHistory, state.recentTopics),
      consecutiveFailures: result.endReason === 'error' ? state.consecutiveFailures + 1 : 0,
    });

    // 兴趣回灌：本次游荡学到的话题 → 图谱强化/新增，persist 触发兴趣快照
    // （S13 evolution 数据源；失败不阻断游荡结果）
    await this.reinforceInterestGraph(this.extractRecentTopics(ctx.wanderHistory, []));
  }

  /** 兴趣回灌：已存在节点强化，新话题加入图谱（来源 reflection） */
  private async reinforceInterestGraph(topics: string[]): Promise<void> {
    if (topics.length === 0) return;
    try {
      const graph = getInterestGraph();
      await graph.load();
      for (const id of topics) {
        if (id.length > 64) continue; // 过长的 query/URL 不构成稳定兴趣
        if (graph.getNode(id)) {
          graph.reinforce(id, WANDER_REINFORCE_DELTA);
        } else {
          graph.addInterest(id, WANDER_NEW_INTEREST_WEIGHT, 'reflection');
        }
      }
      await graph.persist();
      logger.info('兴趣图谱已回灌', { topics: topics.length });
    } catch (err) {
      logger.warn('兴趣回灌失败，不影响游荡结果', { error: String(err) });
    }
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
