import { describe, test, expect, afterEach } from 'vitest';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import {
  validateConfig,
  getRecoveryTier,
  getDataPath,
  getConfig,
  loadConfig,
  setTenantContext,
  config,
} from './config.js';

describe('getDataPath', () => {
  /** 期望的锚点：packages/agent/data（由本测试文件位置推导，不写死机器路径） */
  const expectedRoot = fileURLToPath(new URL('../data', import.meta.url));

  afterEach(() => {
    delete process.env.DATA_DIR;
  });

  test('默认锚定到 agent 包内的 data 目录', () => {
    delete process.env.DATA_DIR;
    expect(getDataPath('state.json')).toBe(join(expectedRoot, 'state.json'));
  });

  test('不随 cwd 漂移', () => {
    delete process.env.DATA_DIR;
    const originalCwd = process.cwd();
    try {
      process.chdir('/tmp');
      expect(getDataPath('state.json')).toBe(join(expectedRoot, 'state.json'));
    } finally {
      process.chdir(originalCwd);
    }
  });

  test('尊重 DATA_DIR 环境变量', () => {
    process.env.DATA_DIR = '/tmp/cyber-stray-test-data';
    expect(getDataPath('state.json')).toBe('/tmp/cyber-stray-test-data/state.json');
  });
});

describe('getRecoveryTier', () => {
  test('低能量返回第一阶梯（recovery=10）', () => {
    expect(getRecoveryTier(5).recovery).toBe(10);
  });

  test('边界值：能量=10 仍属第一阶梯', () => {
    expect(getRecoveryTier(10).recovery).toBe(10);
  });

  test('高能量返回最高阶梯（recovery=2）', () => {
    expect(getRecoveryTier(90).recovery).toBe(2);
  });
});

describe('validateConfig', () => {
  const savedKey = process.env.DEEPSEEK_API_KEY;

  afterEach(() => {
    if (savedKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = savedKey;
    }
  });

  test('缺少 DEEPSEEK_API_KEY 时抛错并指明变量', () => {
    delete process.env.DEEPSEEK_API_KEY;
    expect(() => validateConfig()).toThrow(/DEEPSEEK_API_KEY/);
  });
});

describe('租户上下文（tenant context）', () => {
  /** 期望的锚点：packages/agent/data（由本测试文件位置推导，不写死机器路径） */
  const expectedRoot = fileURLToPath(new URL('../data', import.meta.url));

  afterEach(() => {
    setTenantContext(null);
    delete process.env.DATA_DIR;
  });

  test('getDataPath 优先解析到租户 dataDir', () => {
    setTenantContext({
      tenantId: 't1',
      dataDir: '/tmp/tenants/t1',
      config: getConfig(),
    });
    expect(getDataPath('state.json')).toBe('/tmp/tenants/t1/state.json');
  });

  test('租户 dataDir 优先于 DATA_DIR 环境变量', () => {
    process.env.DATA_DIR = '/tmp/env-data';
    setTenantContext({
      tenantId: 't1',
      dataDir: '/tmp/tenants/t1',
      config: getConfig(),
    });
    expect(getDataPath('state.json')).toBe('/tmp/tenants/t1/state.json');
  });

  test('清除租户上下文后回退 DATA_DIR / 包内锚点', () => {
    setTenantContext({
      tenantId: 't1',
      dataDir: '/tmp/tenants/t1',
      config: getConfig(),
    });
    setTenantContext(null);
    expect(getDataPath('state.json')).toBe(join(expectedRoot, 'state.json'));
  });

  test('getConfig 返回租户配置而非模块级 config', () => {
    const tenantConfig = loadConfig(undefined, { deepseekApiKey: 'tenant-key' });
    expect(tenantConfig.secrets?.deepseekApiKey).toBe('tenant-key');

    setTenantContext({ tenantId: 't1', dataDir: '/tmp/tenants/t1', config: tenantConfig });
    expect(getConfig().secrets?.deepseekApiKey).toBe('tenant-key');
    // 模块级默认 config 不被租户污染
    expect(config.secrets?.deepseekApiKey).toBeUndefined();
  });

  test('loadConfig 从租户 dataDir 读取 agent-config.json 并覆盖行为参数', () => {
    const dir = join(expectedRoot, '.tmp-tenant-cfg');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'agent-config.json'), JSON.stringify({ maxWanderSteps: 7 }), 'utf-8');
    try {
      const tenantConfig = loadConfig(dir);
      expect(tenantConfig.maxWanderSteps).toBe(7);
      // 未配置字段仍取默认
      expect(tenantConfig.heartbeatInterval).toBe(10);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
