/**
 * 用量记录测试（#129，控制面侧）—— petgen recorder 落租户 usage JSONL
 *
 * 契约：recordUsage 写 tenants/<sub>/usage/usage-YYYY-MM-DD.jsonl；
 * createPetUsageRecorder 使用 provider 传入的实际模型，recordImage/recordVision 记次数。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { assertUsageHealthy, createPetUsageRecorder, localDateKey, readTenantUsage, recordUsage } from './usage.js';

describe('createPetUsageRecorder', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-usage-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('recordImage/recordVision 写对租户目录，模型名由请求实际值传入', async () => {
    const recorder = createPetUsageRecorder(dataDir);
    await recorder.recordImage('sub-1', 'doubao-seedream-5-0-260128');
    await recorder.recordVision('sub-1', 'glm-4v-flash');

    const file = join(dataDir, 'tenants', 'sub-1', 'usage', `usage-${localDateKey()}.jsonl`);
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, 'utf-8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(2);

    const image = lines.find((l) => l.kind === 'image');
    expect(image).toBeDefined();
    expect(image!.model).toBe('doubao-seedream-5-0-260128');
    expect(image!.images).toBe(1);
    expect(image!.tenantId).toBe('sub-1');

    const vision = lines.find((l) => l.kind === 'vision_qc');
    expect(vision).toBeDefined();
    expect(vision!.model).toBe('glm-4v-flash');
  });

  it('不同租户写入各自目录（隔离）', async () => {
    const recorder = createPetUsageRecorder(dataDir);
    await recorder.recordImage('a', 'm');
    await recorder.recordImage('b', 'm');
    expect(existsSync(join(dataDir, 'tenants', 'a', 'usage'))).toBe(true);
    expect(existsSync(join(dataDir, 'tenants', 'b', 'usage'))).toBe(true);
    expect(
      readFileSync(join(dataDir, 'tenants', 'a', 'usage', `usage-${localDateKey()}.jsonl`), 'utf-8')
        .trim()
        .split('\n'),
    ).toHaveLength(1);
  });

  it('同一记录器为不同在飞请求保留各自模型名', async () => {
    const recorder = createPetUsageRecorder(dataDir);
    await recorder.recordImage('sub-1', 'doubao-seedream-5-0-260128');
    await recorder.recordImage('sub-1', 'doubao-seedream-4-0');

    const file = join(dataDir, 'tenants', 'sub-1', 'usage', `usage-${localDateKey()}.jsonl`);
    const models = readFileSync(file, 'utf-8')
      .trim()
      .split('\n')
      .map((l) => (JSON.parse(l) as Record<string, unknown>).model);
    expect(models).toContain('doubao-seedream-5-0-260128');
    expect(models).toContain('doubao-seedream-4-0');
  });
});

describe('readTenantUsage（日期归属 = 文件名，行内 UTC timestamp 不再筛）', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-usage-read-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  function writeUsageFile(date: string, rows: Array<Record<string, unknown>>): void {
    const dir = join(dataDir, 'tenants', 'sub', 'usage');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `usage-${date}.jsonl`),
      rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
    );
  }

  it('账本写失败后即使路径修好也保持停派，故障标记跨进程可见', async () => {
    const tenantDir = join(dataDir, 'tenants', 'sub');
    mkdirSync(tenantDir, { recursive: true });
    writeFileSync(join(tenantDir, 'usage'), 'not a directory');
    await expect(recordUsage(tenantDir, { tenantId: 'sub', kind: 'llm', model: 'deepseek-chat', tokens: 10 }))
      .rejects.toThrow('记账失败');
    expect(existsSync(join(tenantDir, 'usage-accounting-block.json'))).toBe(true);
    rmSync(join(tenantDir, 'usage'));
    await expect(assertUsageHealthy(tenantDir)).rejects.toThrow('暂停');
    await expect(readTenantUsage(dataDir, 'sub')).rejects.toThrow('暂停');
  });

  it('仅磁盘持久故障标记也会阻断（无需进程内记忆）', async () => {
    const tenantDir = join(dataDir, 'tenants', 'disk-block');
    mkdirSync(tenantDir, { recursive: true });
    writeFileSync(join(tenantDir, 'usage-accounting-block.json'), '{}');
    await expect(assertUsageHealthy(tenantDir)).rejects.toThrow('记账故障');
  });

  it.each([
    { kind: 'llm', model: 'deepseek-chat', tokens: -1 },
    { kind: 'llm', model: 'deepseek-chat' },
    { kind: 'llm', model: 'deepseek-chat', tokens: 1000, inputTokens: 100 },
    { kind: 'llm', model: 'deepseek-chat', tokens: 1000, inputTokens: 100, outputTokens: 800 },
    { kind: 'image', model: 'm', images: '1' },
    { kind: 'llm', model: 'deepseek-chat', tokens: 1, tenantId: 'another-tenant' },
  ])('拒绝损坏计量与跨租户行 %j', async (invalid) => {
    writeUsageFile('2026-09-29', [{ timestamp: '2026-09-29T00:00:00Z', tenantId: 'sub', ...invalid }]);
    await expect(readTenantUsage(dataDir, 'sub')).rejects.toThrow('用量账本');
    await expect(assertUsageHealthy(join(dataDir, 'tenants', 'sub'))).rejects.toThrow('暂停');
  });

  it('拒绝写入半套 token 拆分，随后调用进入既有记账故障闸', async () => {
    const tenantDir = join(dataDir, 'tenants', 'sub');
    mkdirSync(tenantDir, { recursive: true });
    await expect(recordUsage(tenantDir, {
      tenantId: 'sub', kind: 'llm', model: 'deepseek-chat', tokens: 1000, inputTokens: 100,
    })).rejects.toThrow('用量记账失败');
    expect(existsSync(join(tenantDir, 'usage-accounting-block.json'))).toBe(true);
    await expect(recordUsage(tenantDir, {
      tenantId: 'sub', kind: 'llm', model: 'deepseek-chat', tokens: 1000,
    })).rejects.toThrow('暂停');
  });

  it('时区回归锚：本地日文件里 UTC 日期为前一日的行，当日聚合必须计入', async () => {
    // 东八区 2026-09-29 06:00 写入 → 落 09-29 文件，但 timestamp UTC 日期是 09-28。
    // 旧实现行级按 UTC 日期再筛：查 09-29 时被丢（UTC 09-28 < from）、查 09-28
    // 时又不在 09-28 的文件里——两边都算不到，预算闸漏计每天头 8 小时。
    writeUsageFile('2026-09-29', [
      { timestamp: '2026-09-28T22:00:00.000Z', tenantId: 'sub', kind: 'llm', model: 'deepseek-chat', tokens: 1000 },
      { timestamp: '2026-09-29T05:00:00.000Z', tenantId: 'sub', kind: 'llm', model: 'deepseek-chat', tokens: 2000 },
    ]);
    const rows = await readTenantUsage(dataDir, 'sub', '2026-09-29', '2026-09-29');
    expect(rows).toHaveLength(2);
  });

  it('from/to 按文件名日期键过滤（跨日范围取整文件）', async () => {
    writeUsageFile('2026-09-28', [
      { timestamp: '2026-09-27T20:00:00.000Z', tenantId: 'sub', kind: 'llm', model: 'deepseek-chat', tokens: 1 },
    ]);
    writeUsageFile('2026-09-29', [
      { timestamp: '2026-09-29T01:00:00.000Z', tenantId: 'sub', kind: 'llm', model: 'deepseek-chat', tokens: 2 },
    ]);
    writeUsageFile('2026-09-30', [
      { timestamp: '2026-09-30T01:00:00.000Z', tenantId: 'sub', kind: 'llm', model: 'deepseek-chat', tokens: 3 },
    ]);
    expect(await readTenantUsage(dataDir, 'sub', '2026-09-28', '2026-09-29')).toHaveLength(2);
    expect(await readTenantUsage(dataDir, 'sub', '2026-09-30', '2026-09-30')).toHaveLength(1);
    expect(await readTenantUsage(dataDir, 'sub')).toHaveLength(3);
  });

  it('损坏账本显式失败，不允许预算闸漏计；新租户无账本是空态', async () => {
    writeUsageFile('2026-09-29', [
      { timestamp: '2026-09-29T01:00:00.000Z', tenantId: 'sub', kind: 'llm', model: 'deepseek-chat', tokens: 1 },
    ]);
    // 追加半行（崩溃残留）
    const file = join(dataDir, 'tenants', 'sub', 'usage', 'usage-2026-09-29.jsonl');
    writeFileSync(file, readFileSync(file, 'utf-8') + '{"timestamp": "2026-09-29', 'utf-8');
    await expect(readTenantUsage(dataDir, 'sub', '2026-09-29', '2026-09-29')).rejects.toThrow('用量账本');
    await expect(readTenantUsage(dataDir, 'sub', '2026-09-30', '2026-09-30')).rejects.toThrow('暂停');
    expect(await readTenantUsage(dataDir, 'nobody')).toEqual([]);
  });
});
