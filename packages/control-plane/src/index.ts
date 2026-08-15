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
import { DEFAULT_RATES } from './scheduler/propagate.js';
import { Scheduler } from './scheduler/scheduler.js';
import {
  createWorkerRunner,
  stopAllWorkers,
  sweepStaleSecretFiles,
} from './scheduler/worker-runner.js';

const config = loadConfig();

// S3：启动时应用 SQLite 迁移（幂等；Postgres 切换需按 pg dialect 重生成迁移）
await runMigrations(config.dataDir);

// S4：预热 master key（fail-fast——MK 缺失/损坏尽早暴露，而非租户登录时才炸）
await loadMasterKey(config.dataDir);

// S5：清扫上次崩溃残留的明文 secrets 临时文件（/tmp cp-secrets-*.json）
await sweepStaleSecretFiles();

// S5/S8：事件总线（调度器发布，SSE 路由消费——同一实例）
const bus = createEventBus();

const app = createApp({ config, oidc: createCasdoorOidc(config), bus });

// S5：调度器（嵌入控制面进程；无常驻宠物进程，就绪才拉起短命 worker）
const scheduler = new Scheduler({
  db: () => getDb(config.dataDir),
  dataDir: config.dataDir,
  bus,
  runner: createWorkerRunner({
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
});
scheduler.start(config.schedulerIntervalMs);

// 优雅关停：停 tick + 杀在飞 worker（防孤儿并发写租户 state.json）
const shutdown = () => {
  scheduler.stop();
  stopAllWorkers();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log(
  `[control-plane] listening on :${config.port} (dataDir=${config.dataDir}, ` +
    `scheduler=${config.schedulerIntervalMs > 0 ? `${config.schedulerIntervalMs}ms ×${config.schedulerMaxConcurrent}` : 'off'})`,
);

export default {
  port: config.port,
  fetch: app.fetch,
};
