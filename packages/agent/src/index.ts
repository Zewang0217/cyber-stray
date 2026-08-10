import { StrayHarness } from './core/stray-harness.js';

const harness = new StrayHarness();
harness.start().catch((error) => {
  console.error('启动失败', error);
  process.exit(1);
});
