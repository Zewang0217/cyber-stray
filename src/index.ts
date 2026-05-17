import { config, validateConfig } from "./config.js";
import { loadState, heartbeat, saveState } from "./agent/state.js";
import { runAgentLoop } from "./agent/react.js";
import { initLogger, consola } from "./logger.js";
import { updateState, shutdownTUI, isTuiActive } from "./tui/index.js";
import { initFeishuWS, closeFeishuWS } from "./tools/feishu/ws-client.js";

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

  // 注册信号处理器
  registerSignalHandlers();

  // 启动心跳定时器
  startHeartbeat();

  logger.info("心跳定时器已启动", {
    interval: `${config.heartbeatInterval}分钟`,
  });

  // 保持进程运行
  logger.info("街溜子已就位，开始溜达...");
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

      // 3. 保存当前状态
      try {
        await saveState(await loadState());
        logger.info("状态已保存");
      } catch (err) {
        logger.warn("保存状态失败", { error: String(err) });
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
      logger.error("关闭过程出错", { error: String(err) });
      process.exit(1);
    } finally {
      clearTimeout(forceExitTimer);
    }
  };

  process.on('SIGINT', () => { handleSignal('SIGINT'); });
  process.on('SIGTERM', () => { handleSignal('SIGTERM'); });
}

/**
 * 心跳定时器
 */
function startHeartbeat(): void {
  const intervalMs = config.heartbeatInterval * 60 * 1000;

  // 立即执行一次
  runHeartbeat();

  // 定时执行
  heartbeatTimer = setInterval(runHeartbeat, intervalMs);
}

/**
 * 执行心跳
 *
 * 流程：更新状态 → 直接启动 ReAct Loop → LLM 自主决定是否游荡及如何游荡
 */
async function runHeartbeat(): Promise<void> {
  if (shuttingDown) {
    return;
  }

  logger.info("心跳触发");

  try {
    // 1. 更新状态（无聊值增长、精力恢复）
    // 当精力低于阈值时，无聊值暂停增长，让精力自然恢复
    const state = await heartbeat(
      config.boredomGrowthRate,
      config.energyRecoveryRate,
      config.energyRecoveringThreshold,
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
