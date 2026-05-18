import { config, validateConfig, getRecoveryTier } from "./config.js";
import { loadState, heartbeat } from "./agent/state.js";
import { runAgentLoop } from "./agent/react.js";
import { initLogger, consola } from "./logger.js";
import { updateState } from "./tui/index.js";
import { initFeishuWS } from "./tools/feishu/ws-client.js";

let logger: ReturnType<typeof consola.withTag>;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

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

  // 启动心跳定时器
  startHeartbeat();

  logger.info("心跳定时器已启动");

  // 保持进程运行
  logger.info("街溜子已就位，开始溜达...");
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
    if (config.wanderProbabilityEnabled && newState.energy < config.wanderProbabilityThreshold) {
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