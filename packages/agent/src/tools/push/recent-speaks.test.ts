/**
 * recent-speaks 加载器测试（#152 L2 语义去重的数据源）
 *
 * 覆盖：跨天文件聚合（今天+昨天）、pushed 过滤（gated/planLimited 不算
 * "已推送"）、最新在前、limit 截断、缺文件/坏行容错。
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { loadRecentPushedSpeaks } from './recent-speaks.js';
import { speaksFile, todaySpeaksFile } from './push-budget.js';
import { useTempDataDir } from '../../test/helpers.js';
import type { SpeakRecord } from './history-record.js';

function record(overrides: Partial<SpeakRecord>): SpeakRecord {
  return {
    content: '内容',
    type: 'share',
    pushed: true,
    timestamp: new Date().toISOString(),
    title: '默认标题',
    summary: '默认摘要',
    ...overrides,
  };
}

async function writeHistory(fileName: string, records: SpeakRecord[]): Promise<void> {
  const dir = join(process.env.DATA_DIR!, 'history');
  await mkdir(dir, { recursive: true });
  const body = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  await writeFile(join(dir, fileName), body, 'utf-8');
}

describe('loadRecentPushedSpeaks', () => {
  let cleanup: () => void;

  beforeEach(() => {
    ({ cleanup } = useTempDataDir());
  });

  afterEach(() => {
    cleanup();
  });

  test('跨天聚合：昨天与今天的已推送记录都返回，最新在前', async () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    await writeHistory(speaksFile(yesterday), [
      record({ title: '昨天的推送' }),
    ]);
    await writeHistory(todaySpeaksFile(), [
      record({ title: '今天的推送' }),
    ]);

    const recent = await loadRecentPushedSpeaks();
    expect(recent.map((r) => r.title)).toEqual(['今天的推送', '昨天的推送']);
  });

  test('gated / planLimited / 未推送记录不算"已推送"', async () => {
    await writeHistory(todaySpeaksFile(), [
      record({ title: '被门控拦的', pushed: false, gated: true }),
      record({ title: '被预算拦的', pushed: false, planLimited: true }),
      record({ title: '没推出去的', pushed: false }),
      record({ title: '真推送' }),
    ]);

    const recent = await loadRecentPushedSpeaks();
    expect(recent.map((r) => r.title)).toEqual(['真推送']);
  });

  test('limit 截断：只取最新 N 条', async () => {
    await writeHistory(
      todaySpeaksFile(),
      Array.from({ length: 5 }, (_, i) => record({ title: `推送${i}` })),
    );

    const recent = await loadRecentPushedSpeaks(2);
    expect(recent.map((r) => r.title)).toEqual(['推送4', '推送3']);
  });

  test('无历史文件返回空数组（不抛错）', async () => {
    const recent = await loadRecentPushedSpeaks();
    expect(recent).toEqual([]);
  });

  test('坏行跳过，好记录照常返回（观测路径容错，同 countGatePassedToday）', async () => {
    const dir = join(process.env.DATA_DIR!, 'history');
    await mkdir(dir, { recursive: true });
    const good = JSON.stringify(record({ title: '好记录' }));
    await writeFile(join(dir, todaySpeaksFile()), '{broken-json\n' + good + '\n', 'utf-8');

    const recent = await loadRecentPushedSpeaks();
    expect(recent.map((r) => r.title)).toEqual(['好记录']);
  });
});
