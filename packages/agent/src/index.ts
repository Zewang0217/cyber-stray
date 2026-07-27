import { config, validateConfig, getRecoveryTier } from "./config.js";
import { loadState, heartbeat, saveState } from "./agent/state.js";
import { runAgentLoop, handlePostWanderBrowser } from "./agent/react.js";
import { initLogger, consola } from "./logger.js";
import { updateState, shutdownTUI, isTuiActive } from "./tui/index.js";
import { initFeishuWS, closeFeishuWS } from "./tools/feishu/ws-client.js";
import { getMemoryStore, getMemoryConsolidator } from "./memory/long-term.js";
import { cleanupVisitedUrls } from "./tools/dedup/url-tracker.js";
import { getReflectionScheduler } from "./memory/reflection/index.js";
import { initializeInterestGraph, buildInterestConfig } from "./memory/interest-graph.js";
import { browserWarmUp, browserShutdown } from "./tools/browser/lifecycle.js";

let logger: ReturnType<typeof consola.withTag>;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let shuttingDown = false;

/**
 * 主入口
 */
async function main(): Promise<void> {
  // 初始化日志系统（TUI + 文件）
  initLogger();

  // 在 initLogger() 之后获取 consola 实例
  logger = consola.withTag("main");

  logger.info("赛博街溜子启动...");

  // 验证配置
  try {
    validateConfig();
    logger.info("配置验证通过");
  } catch (error) {
    logger.error("配置验证失败", { error: String(error) });
    process.exit(1);
  }

  // 初始化飞书事件订阅（WebSocket 长连接）
  await initFeishuWS();

  // 加载状态
  const state = await loadState();
  updateState(state);
  logger.info("状态加载完成", {
    boredom: state.boredom,
    energy: state.energy,
    mood: state.mood,
    totalWanders: state.totalWanders,
  });

  // Phase 6: 初始化兴趣图谱（种子 + 衰减 + 首次持久化）
  // 修复了 initializeInterestGraph 从未在启动流程调用的 bug
  try {
    const interestConfig = buildInterestConfig(config.interests);
    const graph = await initializeInterestGraph(interestConfig);
    logger.info("兴趣图谱已初始化", {
      nodeCount: graph.getNodeCount(),
      entropy: graph.getEntropy().toFixed(3),
    });
  } catch (error) {
    logger.warn("兴趣图谱初始化失败（不阻断启动）", { error: String(error) });
  }

  // 浏览器预热（best-effort，失败不阻断启动；enabled 是主开关）
  if (config.browser?.enabled !== false && config.browser?.warmUpOnStart !== false) {
    await browserWarmUp();
  }

  // 启动一次性 best-effort 记忆维护（D-02：不自动周期触发，定期调度属 Phase 4 反思周期）
  // 失败仅 warn 不阻断启动（T-01-10：consolidator 失败不应让 agent 起不来）
  await runStartupMemoryMaintenance();

  // Phase 4: 初始化反思调度器
  await initReflectionScheduler();

  // 注册信号处理器
  registerSignalHandlers();

  // 启动心跳定时器
  startHeartbeat();

  logger.info("心跳定时器已启动");

  // 保持进程运行
  logger.info("街溜子已就位，开始溜达...");
}

/**
 * 启动一次性记忆维护（D-02：best-effort，不自动周期触发）
 *
 * - cleanupVisitedUrls：按 config.consolidation.urlCleanupDays 清理过期 URL 去重记录
 * - MemoryConsolidator.consolidateOldMemories + cleanupExpired：合并/清理记忆（D-01 软删除）
 *
 * 失败仅 logger.warn，不阻断 agent 启动（T-01-10）。定期调度属 Phase 4 反思周期。
 */
async function runStartupMemoryMaintenance(): Promise<void> {
  // CR-01：启动期索引一致性校验/自愈（.index.json 缺失/损坏/空但 Markdown 存在 → 从 Markdown 重建）
  // 失败仅 warn，不阻断启动（与下方 consolidator 一致的 best-effort 策略）
  try {
    await getMemoryStore().ensureIndexConsistent();
  } catch (error) {
    logger.warn("启动期索引校验/重建失败（不阻断启动）", { error: String(error) });
  }

  const urlCleanupDays = config.consolidation?.urlCleanupDays ?? 30;
  try {
    const removed = await cleanupVisitedUrls(urlCleanupDays);
    if (removed > 0) {
      logger.info("启动期清理过期 URL 去重记录", { removed, urlCleanupDays });
    }
  } catch (error) {
    logger.warn("cleanupVisitedUrls 启动执行失败（不阻断启动）", { error: String(error) });
  }

  try {
    const consolidator = getMemoryConsolidator(getMemoryStore());
    const merged = await consolidator.consolidateOldMemories();
    const expired = await consolidator.cleanupExpired();
    logger.info("启动期记忆 consolidator 一次性执行", { merged, expired });
  } catch (error) {
    logger.warn("记忆 consolidator 启动执行失败（不阻断启动）", { error: String(error) });
  }
}

/**
 * Phase 4: 初始化反思调度器。
 *
 * 加载调度状态并配置引擎。失败仅 warn 不阻断启动。
 */
async function initReflectionScheduler(): Promise<void> {
  try {
    const scheduler = getReflectionScheduler();
    await scheduler.load();
    logger.info("反思调度器已初始化", {
      wanderCount: scheduler.getState().wanderCount,
      lastReflectionAt: scheduler.getState().lastReflectionAt,
      totalReflections: scheduler.getState().totalReflections,
    });
  } catch (error) {
    logger.warn("反思调度器初始化失败（不阻断启动）", { error: String(error) });
  }
}

/**
 * 注册 SIGINT / SIGTERM 信号处理器
 * 实现 Ctrl+C 优雅退出
 */
function registerSignalHandlers(): void {
  const handleSignal = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info(`收到 ${signal} 信号，正在优雅关闭...`);

    // 超时保护：3 秒后强制退出
    const forceExitTimer = setTimeout(() => {
      console.log(`\n⚠ 关闭超时，强制退出`);
      process.exit(1);
    }, 3000);
    forceExitTimer.unref();

    try {
      // 1. 停止心跳定时器
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        logger.info("心跳定时器已停止");
      }

      // 2. 关闭飞书 WebSocket 连接
      await closeFeishuWS();

      // 2.5 关闭浏览器
      await browserShutdown();

      // 3. 保存当前状态
      try {
        await saveState(await loadState());
        logger.info("状态已保存");
      } catch (err) {
        logger.warn("保存状态失败", { error: String(err) });
      }

      // 4. 关闭 TUI
      const reason = signal === "SIGINT" ? "Ctrl+C" : signal;
      if (isTuiActive()) {
        shutdownTUI(reason);
      } else {
        process.stdout.write("\x1b[2J\x1b[H");
        console.log(`👋 街溜子下班了... (${reason})`);
        process.exit(0);
      }
    } catch (err) {
      logger.error("关闭过程出错", { error: String(err) });
      process.exit(1);
    } finally {
      clearTimeout(forceExitTimer);
    }
  };

  process.on("SIGINT", () => {
    handleSignal("SIGINT");
  });
  process.on("SIGTERM", () => {
    handleSignal("SIGTERM");
  });
}

/**
 * 获取当前应该使用的心跳间隔和恢复参数
 */
function getHeartbeatParams(state: { energy: number }): {
  interval: number;
  recovery: number;
  boredomGrowth: number;
} {
  const tier = getRecoveryTier(state.energy);
  return {
    interval: tier.interval,
    recovery: tier.recovery,
    boredomGrowth: tier.boredomGrowth,
  };
}

/**
 * 启动心跳定时器
 */
function startHeartbeat(): void {
  // 立即执行一次
  runHeartbeat();
}

/**
 * 更新心跳定时器间隔
 */
function updateHeartbeatInterval(intervalMinutes: number): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  heartbeatTimer = setInterval(runHeartbeat, intervalMs);

  logger.info("心跳间隔已更新", { interval: `${intervalMinutes}分钟` });
}

/**
 * 执行心跳
 *
 * 流程：更新状态 → 概率触发 → ReAct Loop
 */
async function runHeartbeat(): Promise<void> {
  if (shuttingDown) {
    return;
  }

  logger.info("心跳触发");

  try {
    // 获取当前能量对应的心跳参数
    const state = await loadState();
    const params = getHeartbeatParams(state);

    // 更新心跳间隔
    updateHeartbeatInterval(params.interval);

    // 1. 更新状态（使用阶梯恢复参数）
    const newState = await heartbeat(
      params.boredomGrowth,
      params.recovery,
      config.energyRecoveringThreshold,
    );

    updateState(newState);

    logger.info("状态更新", {
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
        logger.info("精力不足，跳过本次游荡", {
          energy: newState.energy,
          probability: `${(probability * 100).toFixed(1)}%`,
          roll: `${(roll * 100).toFixed(1)}%`,
        });
        return;
      }
    }

    // 3. 启动 ReAct Loop
    const result = await runAgentLoop(newState);

    // 游荡后浏览器处理（closeAfterWander 配置）
    await handlePostWanderBrowser();

    // Phase 4: 游荡后触发反思（异步，不阻塞下一轮心跳）
    getReflectionScheduler()
      .tick()
      .catch((err: unknown) =>
        logger.warn("反思调度 tick 失败", { error: String(err) }),
      );

    logger.info("本次游荡结束", {
      steps: result.steps,
      durationMs: result.durationMs,
      spokeTimes: result.spokeTimes,
      visitedUrls: result.visitedUrls.length,
      endReason: result.endReason,
    });
  } catch (error) {
    logger.error("心跳执行失败", { error: String(error) });
  }
}

// 启动
main().catch((error) => {
  logger.error("启动失败", { error: String(error) });
  process.exit(1);
});
