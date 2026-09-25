/**
 * 租户活跃日志测试（#302）—— record 落盘格式 / read 去重与容错
 *
 * 契约：recordTenantActivity 写 tenants/<id>/activity/activity-YYYY-MM-DD.jsonl，
 * 行 { timestamp, tenantId, kind }；readTenantActivityDays 去重出本地日期键，
 * ENOENT = 合法空态，半行/坏行跳过。
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { localDateKey } from './usage.js';
import { readTenantActivityDays, recordTenantActivity } from './tenant-activity.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cp-activity-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('recordTenantActivity', () => {
  it('按日文件追加一行，含 timestamp/tenantId/kind', async () => {
    const tenantDir = join(dataDir, 'tenants', 't-1');
    await recordTenantActivity(tenantDir, 't-1');
    await recordTenantActivity(tenantDir, 't-1');

    const file = join(tenantDir, 'activity', `activity-${localDateKey()}.jsonl`);
    const lines = readFileSyncLines(file);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.tenantId).toBe('t-1');
      expect(line.kind).toBe('session');
      expect(typeof line.timestamp).toBe('string');
      expect(line.timestamp.startsWith(localDateKey())).toBe(true);
    }
  });
});

describe('readTenantActivityDays', () => {
  it('同日多行去重为单日，多日升序', async () => {
    const tenantDir = join(dataDir, 'tenants', 't-1');
    await recordTenantActivity(tenantDir, 't-1');
    await recordTenantActivity(tenantDir, 't-1');

    // 再手写一个「昨日」文件，验证跨文件聚合
    const yesterday = fileDateShift(localDateKey(), -1);
    const dir = join(tenantDir, 'activity');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `activity-${yesterday}.jsonl`),
      JSON.stringify({ timestamp: `${yesterday}T10:00:00.000Z`, tenantId: 't-1', kind: 'session' }) + '\n',
      'utf-8',
    );

    const days = await readTenantActivityDays(tenantDir);
    expect(days).toEqual([yesterday, localDateKey()]);
  });

  it('目录不存在 = 合法空态（租户从未活跃）', async () => {
    const days = await readTenantActivityDays(join(dataDir, 'tenants', 'ghost'));
    expect(days).toEqual([]);
  });

  it('半行写入（崩溃残留）与非法文件名跳过，不拖垮读取', async () => {
    const tenantDir = join(dataDir, 'tenants', 't-1');
    const dir = join(tenantDir, 'activity');
    mkdirSync(dir, { recursive: true });
    const today = localDateKey();
    writeFileSync(
      join(dir, `activity-${today}.jsonl`),
      [
        JSON.stringify({ timestamp: `${today}T08:00:00.000Z`, tenantId: 't-1', kind: 'session' }),
        '{"timestamp":"截断的半行',
        '',
      ].join('\n'),
      'utf-8',
    );
    writeFileSync(join(dir, 'not-activity.jsonl'), 'garbage\n', 'utf-8');

    const days = await readTenantActivityDays(tenantDir);
    expect(days).toEqual([today]);
  });

  it('时间范围 [from, to] 过滤', async () => {
    const tenantDir = join(dataDir, 'tenants', 't-1');
    const dir = join(tenantDir, 'activity');
    mkdirSync(dir, { recursive: true });
    for (const day of ['2026-09-01', '2026-09-10', '2026-09-20']) {
      writeFileSync(
        join(dir, `activity-${day}.jsonl`),
        JSON.stringify({ timestamp: `${day}T08:00:00.000Z`, tenantId: 't-1', kind: 'session' }) + '\n',
        'utf-8',
      );
    }

    expect(await readTenantActivityDays(tenantDir, '2026-09-05', '2026-09-15')).toEqual(['2026-09-10']);
    expect(await readTenantActivityDays(tenantDir, '2026-09-10', '2026-09-10')).toEqual(['2026-09-10']);
  });
});

/** 读 JSONL 为对象数组（测试断言用） */
function readFileSyncLines(file: string): Array<{ timestamp: string; tenantId: string; kind: string }> {
  return readFileSync(file, 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

/** 本地日期键 ±N 天（测试辅助；与 metrics/x1.ts 的 addDays 同口径但独立实现） */
function fileDateShift(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
