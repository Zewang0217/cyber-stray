import { config, validateConfig } from "./config";
import { loadState, saveState, heartbeat } from "./agent/state";
import { consola } from "./logger";

const logger = consola.withTag("main");

/**
 * 主入口
 */
async function main(): Promise<void> {
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
  logger.info("状态加载完成", {
    boredom: state.boredom,
    energy: state.energy,
    mood: state.mood,
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
 */
async function runHeartbeat(): Promise<void> {
  logger.info("心跳触发");

  try {
    // 1. 更新状态
    const state = await heartbeat(
      config.boredomGrowthRate,
      config.energyRecoveryRate,
    );

    logger.info("状态更新", {
      boredom: state.boredom,
      energy: state.energy,
      mood: state.mood,
      temper: state.temper,
    });

    // 2. 决策（TODO: Phase 3 实现）
    // const decision = await decide(state);

    // 3. 执行行动（TODO: Phase 4 实现）
    // await executeAction(decision);
  } catch (error) {
    logger.error("心跳执行失败", { error: String(error) });
  }
}

// 启动
main().catch((error) => {
  logger.error("启动失败", { error: String(error) });
  process.exit(1);
});
