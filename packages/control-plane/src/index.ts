/**
 * 控制面入口（Bun serve）+ 调度器启动（S5）
 */

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createCasdoorOidc } from './oidc.js';
import { getDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { loadMasterKey } from './secrets/master-key.js';
import { createEventBus } from './events/bus.js';
import { Scheduler } from './scheduler/scheduler.js';
import { attachPushGateway } from './push/push-gateway.js';
import { DEFAULT_RATES } from './scheduler/propagate.js';
import {
  createWorkerRunner,
  stopAllWorkers,
  sweepStaleSecretFiles,
} from './scheduler/worker-runner.js';
import { createDiaryRunner, stopAllDiaryWorkers } from './scheduler/diary-runner.js';
import { IlinkClient } from './ilink/client.js';
import { BindingService } from './ilink/binding-service.js';
import { WechatPoller } from './ilink/poller.js';
import { createWechatPushGateway } from './ilink/wechat-gateway.js';
import { PetGenProcessor } from './petgen/processor.js';
import { createImageGenerator } from './petgen/ark.js';
import { createVisionQc } from './petgen/vision.js';
import { createSplitter } from './petgen/splitter.js';
import { createStructureQc } from './petgen/structure-qc.js';
import { createPetUsageRecorder } from './usage.js';
import { refreshModelConfig, getModelConfig } from './app-config.js';
import { runGracefulShutdown } from './graceful-shutdown.js';
import { initLogger } from './logger.js';

const config = loadConfig();

// #116：结构化日志（stdout JSON → journald + dataDir/logs/*.jsonl）
initLogger(config.dataDir);

// S3：启动时应用 SQLite 迁移（幂等；Postgres 切换需按 pg dialect 重生成迁移）
await runMigrations(config.dataDir);

// S4：预热 master key（fail-fast——MK 缺失/损坏尽早暴露，而非租户登录时才炸）
await loadMasterKey(config.dataDir);

// #131：加载全局模型配置（DB → 内存缓存；admin 面板热更新后 refresh）
await refreshModelConfig(config.dataDir, {
  imageModel: config.arkImageModel,
  visionModel: config.visionModel,
});

// S5：清扫上次崩溃残留的明文 secrets 临时文件（/tmp cp-secrets-*.json）
await sweepStaleSecretFiles();

// S5/S8：事件总线（调度器发布，SSE 路由消费——同一实例）
const bus = createEventBus();

// #97：微信通道（每租户 iLink bot——扫码即用 + 双向互动 + 受限推送）。
// 构造注入同一 client 工厂；真实端点联调前按"部署后验证项"核对协议字段。
const makeIlinkClient = (baseUrl: string, botToken?: string) =>
  new IlinkClient({ baseUrl, ...(botToken ? { botToken } : {}) });
const wechatBindings = new BindingService({
  dataDir: config.dataDir,
  client: makeIlinkClient,
});
const wechatPoller = new WechatPoller({
  dataDir: config.dataDir,
  clientFactory: makeIlinkClient,
});
// 微信轮询独立于调度器开关：扫描 tick 复用调度间隔（关调度时给 30s 兜底）
wechatPoller.start(config.schedulerIntervalMs > 0 ? config.schedulerIntervalMs : 30_000);
const detachWechatGateway = createWechatPushGateway({
  dataDir: config.dataDir,
  bus,
  clientFactory: makeIlinkClient,
}).attach();

const app = createApp({ config, oidc: createCasdoorOidc(config), bus, wechatBindings });

// S5：调度器（嵌入控制面进程；无常驻宠物进程，就绪才拉起短命 worker）
const scheduler = new Scheduler({
  db: () => getDb(config.dataDir),
  dataDir: config.dataDir,
  bus,
  runner: createWorkerRunner({
    dataDir: config.dataDir,
    timeoutMs: config.workerTimeoutMs,
  }),
  diaryRunner: createDiaryRunner({
    dataDir: config.dataDir,
    timeoutMs: config.workerTimeoutMs,
  }),
  now: () => Date.now(),
  config: {
    maxConcurrent: config.schedulerMaxConcurrent,
    maxRetries: config.workerMaxRetries,
    retryBackoffMs: config.workerRetryBackoffMs,
    workerTimeoutMs: config.workerTimeoutMs,
    rates: DEFAULT_RATES,
  },
  memeEnabled: config.memeEnabled,
});
scheduler.start(config.schedulerIntervalMs);

// #128：宠物 IP 生成任务处理器（异步队列状态机；生图/视觉/切分全部注入，
// 无 ARK_API_KEY 时任务在概念图阶段显式失败——不静默）
const petGenProcessor = new PetGenProcessor({
  dataDir: config.dataDir,
  db: await getDb(config.dataDir),
  imageGen: createImageGenerator(config.arkApiKey, {
    // #131：每次 generate 读配置缓存（admin 改面板 → 下次生图即生效，无重启）
    model: () => getModelConfig({ imageModel: config.arkImageModel, visionModel: config.visionModel }).imageModel,
    size: '2K', // Seedream 5.0 无 1K 档，最小 2K（2048×2048）
  }),
  visionQc: createVisionQc(config.visionApiKey, { model: config.visionModel }),
  splitter: createSplitter(),
  structureQc: createStructureQc(),
  // #129：petgen 生图/质检用量记录（no-throw）
  usage: createPetUsageRecorder(config.dataDir, {
    imageModel: config.arkImageModel,
    visionModel: config.visionModel,
  }),
  config: {
    maxBatchRetries: 2,
    maxQcRetries: 2,
    conceptFrame: 512,
    referenceFrame: 384,
    gridSize: '1024*1024',
  },
});
petGenProcessor.start(config.petGenIntervalMs);

// S10：Web Push 分发器（worker_succeeded → 读最新推送 → 系统级通知）
const detachPushGateway = attachPushGateway({ dataDir: config.dataDir, bus });

// 优雅关停（#138/ADR-0008）：停派发 → 等在飞游荡收口（预算内）→ 卸推送分发
// → 退出。预算耗尽：强制终止在飞 worker，孤儿由既有 lease/DB 冷却自愈。
// 二次信号：立即退出（不等收口；容器 stop 的 SIGKILL 是最终兜底）。
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) {
    console.log('[shutdown] 收到二次停止信号，立即退出');
    process.exit(1);
  }
  shuttingDown = true;
  void runGracefulShutdown({
    stopDispatch: () => {
      scheduler.stop();
      petGenProcessor.stop();
      wechatPoller.stop();
    },
    drain: () => scheduler.drain(),
    forceKill: () => {
      stopAllWorkers();
      stopAllDiaryWorkers();
    },
    detach: () => {
      detachPushGateway();
      detachWechatGateway();
    },
    exit: (code) => process.exit(code),
    budgetMs: config.shutdownBudgetMs,
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log(
  `[control-plane] listening on :${config.port} (dataDir=${config.dataDir}, ` +
    `scheduler=${config.schedulerIntervalMs > 0 ? `${config.schedulerIntervalMs}ms ×${config.schedulerMaxConcurrent}` : 'off'}, ` +
    `wechat-poller=armed)`,
);

export default {
  port: config.port,
  fetch: app.fetch,
};
