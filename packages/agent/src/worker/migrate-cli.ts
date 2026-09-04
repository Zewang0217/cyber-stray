#!/usr/bin/env node
/**
 * 用户画像目录化迁移 CLI（S1 #150）
 *
 * 用法:
 *   pnpm --filter @cyber-stray/agent migrate:user-profile -- --dataDir <数据根>
 *   - 单机:  --dataDir $DATA_DIR
 *   - 生产租户: --dataDir /opt/cyber-stray/data/tenants/<tenant-id>
 *   - 也可设 DATA_DIR 环境变量后省略 --dataDir
 *
 * 幂等：重跑安全（新文件已存在则跳过，只补占位文件）；旧文件保留不动。
 */
import { parseArgs } from 'node:util';
import { migrateUserProfile } from '../migration/migrate-user-profile.js';
const { values } = parseArgs({
  // pnpm 的 `--` 分隔符会原样传到 script，node parseArgs 遇裸 `--` 后不再解析选项
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    dataDir: { type: 'string' },
  },
});
const dataDir = values.dataDir ?? process.env.DATA_DIR;
if (!dataDir) {
  console.error('用法: migrate:user-profile -- --dataDir <数据根>（或设置 DATA_DIR）');
  process.exit(1);
}

try {
  const report = await migrateUserProfile(dataDir);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error('迁移失败:', error);
  process.exit(1);
}