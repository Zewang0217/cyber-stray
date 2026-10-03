/**
 * 证据快照测试（#299 验收）—— 读数容错 + 聚合 + Markdown 渲染
 *
 * 契约：ENOENT = 合法空态；半行/坏行跳过；结构损坏抛错（禁兜底）；
 * 聚合只读生产数据，不写租户目录。
 */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readTenantFeedback,
  readTenantSpeaks,
  readTenantInterestTrajectory,
  renderTenantMarkdown,
  type TenantSnapshot,
} from './snapshot.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cp-snapshot-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function tenantDir(id: string): string {
  return join(dataDir, 'tenants', id);
}

/** 在租户目录写文件（自动建目录；测试辅助） */
function writeTenantFile(id: string, name: string, content: string): void {
  mkdirSync(tenantDir(id), { recursive: true });
  writeFileSync(join(tenantDir(id), name), content, 'utf-8');
}

describe('readTenantFeedback', () => {
  it('分型计数', async () => {
    writeTenantFile(
      't1',
      'feedback.json',
      JSON.stringify({
        feedbacks: [{ type: 'like' }, { type: 'like' }, { type: 'dislike' }, { type: 'boost' }],
      }),
    );
    expect(await readTenantFeedback(tenantDir('t1'))).toEqual({
      total: 4,
      like: 2,
      dislike: 1,
      boost: 1,
    });
  });

  it('ENOENT = 合法空态', async () => {
    expect(await readTenantFeedback(tenantDir('ghost'))).toEqual({
      total: 0,
      like: 0,
      dislike: 0,
      boost: 0,
    });
  });

  it('结构损坏抛错（禁兜底）', async () => {
    writeTenantFile('bad', 'feedback.json', JSON.stringify({ wrong: true }));
    await expect(readTenantFeedback(tenantDir('bad'))).rejects.toThrow();
  });
});

describe('readTenantSpeaks', () => {
  it('漏斗计数 + 首末日，半行跳过', async () => {
    const dir = join(tenantDir('t1'), 'history');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'speaks-2026-09-01.jsonl'),
      [
        JSON.stringify({ pushed: true, gated: false, timestamp: '2026-09-01T08:00:00Z' }),
        JSON.stringify({ pushed: false, gated: true, timestamp: '2026-09-01T09:00:00Z' }),
        '{截断',
      ].join('\n'),
      'utf-8',
    );
    writeFileSync(
      join(dir, 'speaks-2026-09-03.jsonl'),
      JSON.stringify({ pushed: true, timestamp: '2026-09-03T10:00:00Z' }) + '\n',
      'utf-8',
    );

    const funnel = await readTenantSpeaks(tenantDir('t1'));
    expect(funnel.total).toBe(3);
    expect(funnel.pushed).toBe(2);
    expect(funnel.gated).toBe(1);
    expect(funnel.firstDay).toBe('2026-09-01');
    expect(funnel.lastDay).toBe('2026-09-03');
  });

  it('目录不存在 = 合法空态', async () => {
    expect(await readTenantSpeaks(tenantDir('ghost'))).toEqual({
      total: 0,
      pushed: 0,
      gated: 0,
      firstDay: null,
      lastDay: null,
    });
  });
});

describe('readTenantInterestTrajectory', () => {
  it('取首末两端快照（熵与节点数）', async () => {
    writeTenantFile(
      't1',
      'interest-history.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-09-01T00:00:00Z',
          hash: 'a',
          entropy: 1.5,
          nodeCount: 3,
          nodes: [{ id: 'x', weight: 0.5, source: 'default' }],
        }),
        JSON.stringify({
          timestamp: '2026-09-10T00:00:00Z',
          hash: 'b',
          entropy: 2.1,
          nodeCount: 2,
          nodes: [
            { id: 'y', weight: 0.4, source: 'feedback' },
            { id: 'z', weight: 0.3, source: 'reflection' },
          ],
        }),
      ].join('\n'),
    );
    const t = await readTenantInterestTrajectory(tenantDir('t1'));
    expect(t.snapshots).toBe(2);
    expect(t.first?.entropy).toBe(1.5);
    expect(t.last?.entropy).toBe(2.1);
    expect(t.last?.nodeCount).toBe(2);
  });

  it('ENOENT = 合法空态', async () => {
    expect(await readTenantInterestTrajectory(tenantDir('ghost'))).toEqual({
      snapshots: 0,
      first: null,
      last: null,
    });
  });
});

describe('renderTenantMarkdown', () => {
  it('完整快照渲染出答辩可引用的关键数字', () => {
    const snap: TenantSnapshot = {
      tenantId: 't1',
      status: 'ok',
      adoptedDay: '2026-09-01',
      activityDays: ['2026-09-01', '2026-09-10'],
      lastActiveDay: '2026-09-10',
      x1: {
        x1: true,
        windowStart: '2026-09-08',
        windowEnd: '2026-09-15',
        revisitDaysInWindow: ['2026-09-10'],
        totalActiveDays: 2,
        feedbackCount: 2,
      },
      feedback: { total: 2, like: 1, dislike: 1, boost: 0 },
      speaks: { total: 5, pushed: 3, gated: 2, firstDay: '2026-09-01', lastDay: '2026-09-10' },
      interest: { snapshots: 4, first: { day: '2026-09-01', entropy: 1.2, nodeCount: 3 }, last: { day: '2026-09-10', entropy: 1.9, nodeCount: 5 } },
      llmInputTokens: 1200,
      llmOutputTokens: 340,
      imageCount: 2,
    };
    const md = renderTenantMarkdown(snap);
    expect(md).toContain('X1 信念判定：✅ 成立');
    expect(md).toContain('speak 5 次 → 推送 3');
    expect(md).toContain('熵 1.200 → 1.900');
  });
});
