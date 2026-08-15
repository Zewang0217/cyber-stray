/**
 * 控制面入口（Bun serve）
 */

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createCasdoorOidc } from './oidc.js';
import { runMigrations } from './db/migrate.js';

const config = loadConfig();

// S3：启动时应用 SQLite 迁移（幂等；Postgres 切换后自动走 pg 迁移）
await runMigrations(config.dataDir);

const app = createApp({ config, oidc: createCasdoorOidc(config) });

console.log(`[control-plane] listening on :${config.port} (dataDir=${config.dataDir})`);

export default {
  port: config.port,
  fetch: app.fetch,
};
