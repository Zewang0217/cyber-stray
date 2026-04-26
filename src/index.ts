import { config, validateConfig } from "./config.js";
import { loadState, heartbeat } from "./agent/state.js";
import { runAgentLoop } from "./agent/react.js";
import { initLogger, consola } from "./logger.js";
import { updateState } from "./tui/index.js";

let logger: ReturnType<typeof consola.withTag>;

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

  logger.info("心跳定时器已启动", {
    interval: `${config.heartbeatInterval}分钟`,
  });

  // 保持进程运行
  logger.info("街溜子已就位，开始溜达...");
}

/**
 * 心跳定时器
 */
function startHeartbeat(): void {
  const intervalMs = config.heartbeatInterval * 60 * 1000;

  // 立即执行一次
  runHeartbeat();

  // 定时执行
  setInterval(runHeartbeat, intervalMs);
}

/**
 * 执行心跳
 *
 * 流程：更新状态 → 直接启动 ReAct Loop → LLM 自主决定是否游荡及如何游荡
 */
async function runHeartbeat(): Promise<void> {
  logger.info("心跳触发");

  try {
    // 1. 更新状态（无聊值增长、精力恢复）
    const state = await heartbeat(
      config.boredomGrowthRate,
      config.energyRecoveryRate,
    );

    updateState(state);

    logger.info("状态更新", {
      boredom: state.boredom,
      energy: state.energy,
      mood: state.mood,
      temper: state.temper,
    });

    // 2. 直接启动 ReAct Loop
    // LLM 在第一步自主决定：游荡 or 直接 rest()
    const result = await runAgentLoop(state);

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
