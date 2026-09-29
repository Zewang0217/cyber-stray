/**
 * 用量记录测试（#129，控制面侧）—— petgen recorder 落租户 usage JSONL
 *
 * 契约：recordUsage 写 tenants/<sub>/usage/usage-YYYY-MM-DD.jsonl；
 * createPetUsageRecorder 闭包绑定模型名，recordImage/recordVision 记张数。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createPetUsageRecorder, localDateKey, readTenantUsage } from './usage.js';

describe('createPetUsageRecorder', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-usage-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('recordImage/recordVision 写对租户目录，模型名闭包绑定', async () => {
    const recorder = createPetUsageRecorder(dataDir, {
      imageModel: 'doubao-seedream-5-0-260128',
      visionModel: 'glm-4v-flash',
    });
    recorder.recordImage('sub-1');
    recorder.recordVision('sub-1');
    // 等待异步落盘（no-throw fire-and-forget；两行并发 append，顺序不保证）
    await new Promise((r) => setTimeout(r, 100));

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
    const recorder = createPetUsageRecorder(dataDir, { imageModel: 'm', visionModel: 'v' });
    recorder.recordImage('a');
    recorder.recordImage('b');
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(dataDir, 'tenants', 'a', 'usage'))).toBe(true);
    expect(existsSync(join(dataDir, 'tenants', 'b', 'usage'))).toBe(true);
    expect(
      readFileSync(join(dataDir, 'tenants', 'a', 'usage', `usage-${localDateKey()}.jsonl`), 'utf-8')
        .trim()
        .split('\n'),
    ).toHaveLength(1);
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

  it('坏行跳过不拖垮聚合；usage 目录不存在 = 空态', async () => {
    writeUsageFile('2026-09-29', [
      { timestamp: '2026-09-29T01:00:00.000Z', tenantId: 'sub', kind: 'llm', model: 'deepseek-chat', tokens: 1 },
    ]);
    // 追加半行（崩溃残留）
    const file = join(dataDir, 'tenants', 'sub', 'usage', 'usage-2026-09-29.jsonl');
    writeFileSync(file, readFileSync(file, 'utf-8') + '{"timestamp": "2026-09-29', 'utf-8');
    expect(await readTenantUsage(dataDir, 'sub', '2026-09-29', '2026-09-29')).toHaveLength(1);
    expect(await readTenantUsage(dataDir, 'nobody')).toEqual([]);
  });
});
