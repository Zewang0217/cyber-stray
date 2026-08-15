/**
 * 控制面入口（Bun serve）
 */

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createCasdoorOidc } from './oidc.js';
import { runMigrations } from './db/migrate.js';
import { loadMasterKey } from './secrets/master-key.js';

const config = loadConfig();

// S3：启动时应用 SQLite 迁移（幂等；Postgres 切换后自动走 pg 迁移）
await runMigrations(config.dataDir);

// S4：预热 master key（fail-fast——MK 缺失/损坏尽早暴露，而非租户登录时才炸）
await loadMasterKey(config.dataDir);

const app = createApp({ config, oidc: createCasdoorOidc(config) });

console.log(`[control-plane] listening on :${config.port} (dataDir=${config.dataDir})`);

export default {
  port: config.port,
  fetch: app.fetch,
};
