/**
 * StrayHarness — 编排层
 *
 * 负责进程级编排：心跳调度、反思触发、持久化、信号处理。
 * 不关心游荡内部逻辑——那是 WanderAgent 的事。
 *
 * 从 index.ts 提取，行为完全不变。
 */

import { config, validateConfig, getRecoveryTier } from '../config.js';
import { loadState, heartbeat, saveState } from '../agent/state.js';
import { initLogger, consola } from '../logger.js';
import { updateState as tuiUpdateState, shutdownTUI, isTuiActive } from '../tui/index.js';
import { initFeishuWS, closeFeishuWS } from '../tools/feishu/ws-client.js';
import { getMemoryStore, getMemoryConsolidator } from '../memory/long-term.js';
import { cleanupVisitedUrls } from '../tools/dedup/url-tracker.js';
import { getReflectionScheduler } from '../memory/reflection/index.js';
import { initializeInterestGraph, buildInterestConfig } from '../memory/interest-graph.js';
import { WanderAgent } from './wander-agent.js';
import type { WanderEvent } from './events.js';

export class StrayHarness {
  private agent: WanderAgent;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private shuttingDown = false;
  private logger: ReturnType<typeof consola.withTag>;

  constructor() {
    this.agent = new WanderAgent(config);
    this.logger = consola.withTag('harness');

    // 订阅事件 → 日志（consola 降为 subscriber）
    this.agent.onEvent((event) => this.logEvent(event));
  }

  /** 启动 */
  async start(): Promise<void> {
    initLogger();
    this.logger = consola.withTag('harness');

    this.logger.info('赛博街溜子启动...');

    // 验证配置
    try {
      validateConfig();
      this.logger.info('配置验证通过');
    } catch (error) {
      this.logger.error('配置验证失败', { error: String(error) });
      process.exit(1);
    }

    // 初始化飞书事件订阅
    await initFeishuWS();

    // 加载状态
    const state = await loadState();
    tuiUpdateState(state);
    this.logger.info('状态加载完成', {
      boredom: state.boredom,
      energy: state.energy,
      mood: state.mood,
      totalWanders: state.totalWanders,
    });

    // 初始化兴趣图谱
    try {
      const interestConfig = buildInterestConfig(config.interests);
      const graph = await initializeInterestGraph(interestConfig);
      this.logger.info('兴趣图谱已初始化', {
        nodeCount: graph.getNodeCount(),
        entropy: graph.getEntropy().toFixed(3),
      });
    } catch (error) {
      this.logger.warn('兴趣图谱初始化失败（不阻断启动）', { error: String(error) });
    }

    // 启动一次性记忆维护
    await this.runStartupMemoryMaintenance();

    // 初始化反思调度器
    await this.initReflectionScheduler();

    // 注册信号处理器
    this.registerSignalHandlers();

    // 启动心跳（立即执行一次）
    this.runHeartbeat();

    this.logger.info('街溜子已就位，开始溜达...');
  }

  /** 优雅关闭 */
  async stop(signal: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    this.logger.info(`收到 ${signal} 信号，正在优雅关闭...`);

    const forceExitTimer = setTimeout(() => {
      console.log('\n⚠ 关闭超时，强制退出');
      process.exit(1);
    }, 3000);
    forceExitTimer.unref();

    try {
      // 1. 停止心跳定时器
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
        this.logger.info('心跳定时器已停止');
      }

      // 2. 关闭飞书 WebSocket 连接
      await closeFeishuWS();

      // 3. 保存当前状态
      try {
        await saveState(await loadState());
        this.logger.info('状态已保存');
      } catch (err) {
        this.logger.warn('保存状态失败', { error: String(err) });
      }

      // 4. 关闭 TUI
      const reason = signal === 'SIGINT' ? 'Ctrl+C' : signal;
      if (isTuiActive()) {
        shutdownTUI(reason);
      } else {
        process.stdout.write('\x1b[2J\x1b[H');
        console.log(`👋 街溜子下班了... (${reason})`);
        process.exit(0);
      }
    } catch (err) {
      this.logger.error('关闭过程出错', { error: String(err) });
      process.exit(1);
    } finally {
      clearTimeout(forceExitTimer);
    }
  }

  // ─── Private ───

  private async runStartupMemoryMaintenance(): Promise<void> {
    try {
      await getMemoryStore().ensureIndexConsistent();
    } catch (error) {
      this.logger.warn('启动期索引校验/重建失败（不阻断启动）', { error: String(error) });
    }

    const urlCleanupDays = config.consolidation?.urlCleanupDays ?? 30;
    try {
      const removed = await cleanupVisitedUrls(urlCleanupDays);
      if (removed > 0) {
        this.logger.info('启动期清理过期 URL 去重记录', { removed, urlCleanupDays });
      }
    } catch (error) {
      this.logger.warn('cleanupVisitedUrls 启动执行失败（不阻断启动）', { error: String(error) });
    }

    try {
      const consolidator = getMemoryConsolidator(getMemoryStore());
      const merged = await consolidator.consolidateOldMemories();
      const expired = await consolidator.cleanupExpired();
      this.logger.info('启动期记忆 consolidator 一次性执行', { merged, expired });
    } catch (error) {
      this.logger.warn('记忆 consolidator 启动执行失败（不阻断启动）', { error: String(error) });
    }
  }

  private async initReflectionScheduler(): Promise<void> {
    try {
      const scheduler = getReflectionScheduler();
      await scheduler.load();
      this.logger.info('反思调度器已初始化', {
        wanderCount: scheduler.getState().wanderCount,
        lastReflectionAt: scheduler.getState().lastReflectionAt,
        totalReflections: scheduler.getState().totalReflections,
      });
    } catch (error) {
      this.logger.warn('反思调度器初始化失败（不阻断启动）', { error: String(error) });
    }
  }

  private registerSignalHandlers(): void {
    process.on('SIGINT', () => { this.stop('SIGINT'); });
    process.on('SIGTERM', () => { this.stop('SIGTERM'); });
  }

  private updateHeartbeatInterval(intervalMinutes: number): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    const intervalMs = intervalMinutes * 60 * 1000;
    this.heartbeatTimer = setInterval(() => { this.runHeartbeat(); }, intervalMs);
    this.logger.info('心跳间隔已更新', { interval: `${intervalMinutes}分钟` });
  }

  private async runHeartbeat(): Promise<void> {
    if (this.shuttingDown) return;

    this.logger.info('心跳触发');

    try {
      const state = await loadState();
      const tier = getRecoveryTier(state.energy);
      const params = {
        interval: tier.interval,
        recovery: tier.recovery,
        boredomGrowth: tier.boredomGrowth,
      };

      // 更新心跳间隔
      this.updateHeartbeatInterval(params.interval);

      // 1. 更新状态
      const newState = await heartbeat(
        params.boredomGrowth,
        params.recovery,
        config.energyRecoveringThreshold,
      );
      tuiUpdateState(newState);

      this.logger.info('状态更新', {
        boredom: newState.boredom,
        energy: newState.energy,
        mood: newState.mood,
        temper: newState.temper,
        recoveryTier: {
          interval: params.interval,
          recovery: params.recovery,
          boredomGrowth: params.boredomGrowth,
        },
      });

      // 2. 概率触发 Wander
      if (
        config.wanderProbabilityEnabled &&
        newState.energy < config.wanderProbabilityThreshold
      ) {
        const probability = newState.energy / 100;
        const roll = Math.random();

        if (roll > probability) {
          this.logger.info('精力不足，跳过本次游荡', {
            energy: newState.energy,
            probability: `${(probability * 100).toFixed(1)}%`,
            roll: `${(roll * 100).toFixed(1)}%`,
          });
          return;
        }
      }

      // 3. 启动游荡（通过 WanderAgent）
      const result = await this.agent.wander(newState);

      // 4. 游荡后触发反思
      getReflectionScheduler()
        .tick()
        .catch((err: unknown) =>
          this.logger.warn('反思调度 tick 失败', { error: String(err) }),
        );

      this.logger.info('本次游荡结束', {
        steps: result.steps,
        durationMs: result.durationMs,
        spokeTimes: result.spokeTimes,
        visitedUrls: result.visitedUrls.length,
        endReason: result.endReason,
      });
    } catch (error) {
      this.logger.error('心跳执行失败', { error: String(error) });
    }
  }

  /** 事件 → 日志 subscriber */
  private logEvent(event: WanderEvent): void {
    switch (event.type) {
      case 'wander_start':
        this.logger.debug(`[${event.traceId}] 游荡开始 (maxSteps=${event.maxSteps})`);
        break;
      case 'wander_end':
        this.logger.debug(`游荡结束 (${event.result.endReason}, ${event.result.steps} steps)`);
        break;
      case 'tool_call_start':
        this.logger.debug(`工具调用: ${event.tool}`);
        break;
      case 'tool_call_end':
        if (!event.success) {
          this.logger.debug(`工具失败: ${event.tool} — ${event.error}`);
        }
        break;
      case 'step_end':
        this.logger.debug(`步 ${event.step} 结束 [${event.action}]`);
        break;
      case 'speak':
        this.logger.debug(`推送 [${event.speakType}] gated=${event.gated} score=${event.score ?? 'N/A'}`);
        break;
      case 'error':
        this.logger.warn(`事件错误 [${event.phase}]: ${event.error} (recoverable=${event.recoverable})`);
        break;
    }
  }
}
