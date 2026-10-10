import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  loadAlleys,
  resolveAlley,
  formatAlleyListForPrompt,
  MAX_ALLEYS,
} from './alleys.js';

describe('alleys 巷子清单', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'alleys-'));
    process.env.DATA_DIR = dir;
  });
  afterEach(() => {
    delete process.env.DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  test('空文件 → 空清单', async () => {
    expect(await loadAlleys()).toEqual({ alleys: [] });
  });

  test('新名追加并落盘', async () => {
    expect(await resolveAlley('量子巷')).toBe('量子巷');
    const list = await loadAlleys();
    expect(list.alleys.map((a) => a.name)).toEqual(['量子巷']);
  });

  test('大小写 / 空白命中归并到清单写法', async () => {
    await resolveAlley('AI 观察站');
    expect(await resolveAlley('ai 观察站')).toBe('AI 观察站');
    expect(await resolveAlley('  AI 观察站  ')).toBe('AI 观察站');
    const list = await loadAlleys();
    expect(list.alleys).toHaveLength(1);
  });

  test('近义异名不合并（无模糊匹配），一致性靠 prompt 复用', async () => {
    await resolveAlley('量子巷');
    expect(await resolveAlley('量子深巷')).toBe('量子深巷');
    expect((await loadAlleys()).alleys).toHaveLength(2);
  });

  test('空值与超长名沿用 fallback', async () => {
    await resolveAlley('猫事务司');
    expect(await resolveAlley(undefined, '猫事务司')).toBe('猫事务司');
    expect(await resolveAlley('x'.repeat(21), '猫事务司')).toBe('猫事务司');
    expect((await loadAlleys()).alleys).toHaveLength(1);
  });

  test('超上限按 lastUsedAt 淘汰最旧', async () => {
    for (let i = 0; i < MAX_ALLEYS; i++) await resolveAlley(`巷子${i}`);
    // 刷新「巷子0」使其不是最旧
    await resolveAlley('巷子0');
    await resolveAlley('新巷子');
    const names = (await loadAlleys()).alleys.map((a) => a.name);
    expect(names).toHaveLength(MAX_ALLEYS);
    expect(names).toContain('巷子0');
    expect(names).toContain('新巷子');
    expect(names).not.toContain('巷子1');
  });

  test('脏数据抛错不兜底', async () => {
    writeFileSync(join(dir, 'alleys.json'), '{"alleys": "oops"}');
    await expect(loadAlleys()).rejects.toThrow();
  });

  test('prompt 格式化：空清单与清单名列表', async () => {
    expect(formatAlleyListForPrompt({ alleys: [] })).toContain('还没有去过');
    await resolveAlley('量子巷');
    const text = formatAlleyListForPrompt(await loadAlleys());
    expect(text).toContain('- 量子巷');
  });
});
