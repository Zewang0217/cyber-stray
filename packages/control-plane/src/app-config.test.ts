/**
 * 全局模型配置测试（#131）—— DB 读写 / 缓存刷新 / 缺省回退 / 校验
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getDb, _resetDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { appConfig } from './db/schema.js';
import {
  refreshModelConfig,
  getModelConfig,
  setModelConfig,
  validateModelId,
} from './app-config.js';

const DEFAULTS = { imageModel: 'default-img', visionModel: 'default-vl' };

describe('app-config（全局模型配置）', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-appconfig-'));
    _resetDb();
    await runMigrations(dataDir);
  });

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('DB 无记录 → 回退 env 默认', async () => {
    const cfg = await refreshModelConfig(dataDir, DEFAULTS);
    expect(cfg).toEqual(DEFAULTS);
    expect(getModelConfig(DEFAULTS)).toEqual(DEFAULTS);
  });

  it('setModelConfig 写 DB + 刷缓存；refresh 重新加载持久化值', async () => {
    await setModelConfig(dataDir, { imageModel: 'new-img', visionModel: 'new-vl' });
    expect(getModelConfig(DEFAULTS)).toEqual({ imageModel: 'new-img', visionModel: 'new-vl' });

    // 模拟重启：清缓存 → refresh 从 DB 读回
    const db = await getDb(dataDir);
    const rows = await db.select().from(appConfig).all();
    expect(rows.map((r) => r.key).sort()).toEqual(['imageModel', 'visionModel']);
    const reloaded = await refreshModelConfig(dataDir, DEFAULTS);
    expect(reloaded).toEqual({ imageModel: 'new-img', visionModel: 'new-vl' });
  });

  it('部分更新：只改 imageModel 保留 visionModel', async () => {
    await setModelConfig(dataDir, { imageModel: 'a', visionModel: 'b' });
    await setModelConfig(dataDir, { imageModel: 'c', visionModel: 'b' });
    expect(getModelConfig(DEFAULTS)).toEqual({ imageModel: 'c', visionModel: 'b' });
  });

  it('validateModelId：空/超长拒绝', () => {
    expect(validateModelId('')).not.toBeNull();
    expect(validateModelId('   ')).not.toBeNull();
    expect(validateModelId(123)).not.toBeNull();
    expect(validateModelId('x'.repeat(101))).not.toBeNull();
    expect(validateModelId('doubao-seedream-5-0-260128')).toBeNull();
  });
});
