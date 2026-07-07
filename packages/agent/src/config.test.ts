import { describe, test, expect, afterEach } from 'vitest';
import { validateConfig, getRecoveryTier, getDataPath } from './config.js';

describe('getDataPath', () => {
  afterEach(() => {
    delete process.env.DATA_DIR;
  });

  test('默认前缀 data/', () => {
    delete process.env.DATA_DIR;
    expect(getDataPath('state.json')).toBe('data/state.json');
  });

  test('尊重 DATA_DIR 环境变量', () => {
    process.env.DATA_DIR = '/tmp/cyber-stray-test-data';
    expect(getDataPath('state.json')).toBe('/tmp/cyber-stray-test-data/state.json');
  });
});

describe('getRecoveryTier', () => {
  test('低能量返回第一阶梯（recovery=10�?, () => {
    expect(getRecoveryTier(5).recovery).toBe(10);
  });

  test('边界值：能量=10 仍属第一阶梯', () => {
    expect(getRecoveryTier(10).recovery).toBe(10);
  });

  test('高能量返回最高阶梯（recovery=2�?, () => {
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
