/**
 * 控制面入口（Bun serve）
 */

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createCasdoorOidc } from './oidc.js';

const config = loadConfig();
const app = createApp({ config, oidc: createCasdoorOidc(config) });

console.log(`[control-plane] listening on :${config.port} (dataDir=${config.dataDir})`);

export default {
  port: config.port,
  fetch: app.fetch,
};
