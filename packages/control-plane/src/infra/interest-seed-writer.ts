/**
 * 领养兴趣种子写入（基础设施层）
 *
 * 写 agent 拥有的 user-profile/user-interests.json；文件形状来自
 * shared/interest-graph 单一真相源（此前 CP 在路由里复制 schema、靠注释与
 * agent 同步，已发生过注释漂移）。仅当文件不存在时写入（wx 独占）——
 * 不覆盖已游荡租户的图谱。
 */

import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import {
  INTEREST_GRAPH_VERSION,
  INTEREST_SEED_WEIGHT,
  type InterestGraphData,
} from '@cyber-stray/shared/interest-graph';
import { tenantDataDir } from './tenant.js';

export async function seedInterestsIfAbsent(
  dataDir: string,
  tenantId: string,
  interests: string[],
): Promise<void> {
  const dir = join(tenantDataDir(dataDir, tenantId), 'user-profile');
  await mkdir(dir, { recursive: true });
  const now = new Date().toISOString();
  const data: InterestGraphData = {
    version: INTEREST_GRAPH_VERSION,
    lastUpdated: now,
    nodes: interests.map((id) => ({
      id,
      weight: INTEREST_SEED_WEIGHT,
      source: 'default',
      createdAt: now,
      lastReinforced: now,
      reinforceCount: 0,
      path: id,
    })),
  };
  try {
    await writeFile(join(dir, 'user-interests.json'), JSON.stringify(data, null, 2), {
      flag: 'wx', // exclusive：已存在则失败（不覆盖）
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
    // 已存在（租户已游荡或已领养）→ 保留原文件
  }
}
