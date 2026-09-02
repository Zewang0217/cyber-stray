/**
 * S2 #151：profile-summary 派生摘要 测试
 *
 * 覆盖：
 * - renderProfileSummary 纯函数：图谱 → markdown（Top 兴趣 + 权重%）
 * - 空图谱输出占位
 * - regenerateProfileSummary 增量：内容未变不写盘；变化则写盘且内容与图谱一致
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import { InterestGraph } from './interest-graph.js';
import {
  renderProfileSummary,
  regenerateProfileSummary,
  profileSummaryPath,
} from './profile-summary.js';
import { useTempDataDir } from '../test/helpers.js';
import { _resetInterestGraphCache } from './interest-graph.js';

describe('profile-summary', () => {
  let cleanup: () => void;

  beforeEach(() => {
    const temp = useTempDataDir();
    cleanup = temp.cleanup;
    _resetInterestGraphCache();
  });

  afterEach(() => {
    cleanup();
  });

  function makeGraph(nodes: Array<{ id: string; weight: number }>): InterestGraph {
    const g = new InterestGraph(join(useTempDataDir().dataDir, 'interests.json'), {
      decayLambda: 0.0116,
      maxWeight: 0.8,
      minInterestCount: 5, // 冷启动期：addInterest 权重不被 novelty 预算钳制
      maxInterestCount: 20,
      noveltyBudget: 0.5,
      defaultSeeds: [],
      minWeight: 0.01,
    });
    for (const n of nodes) g.addInterest(n.id, n.weight, 'default');
    return g;
  }

  it('空图谱输出占位', () => {
    const g = makeGraph([]);
    const out = renderProfileSummary(g);
    expect(out).toContain('profile-summary');
    expect(out).toContain('图谱为空');
  });

  it('列出 Top 兴趣与权重百分比', () => {
    const g = makeGraph([
      { id: '天文', weight: 0.6 },
      { id: 'AI', weight: 0.4 },
    ]);
    const out = renderProfileSummary(g);
    expect(out).toContain('**天文**');
    expect(out).toContain('**AI**');
    expect(out).toContain('60%');
    expect(out).toContain('40%');
    expect(out.indexOf('天文')).toBeLessThan(out.indexOf('AI'));
  });

  it('内容未变时不写盘（增量）', async () => {
    const g = makeGraph([{ id: '天文', weight: 0.5 }]);
    const first = await regenerateProfileSummary(g);
    const m1 = (await stat(profileSummaryPath())).mtimeMs;
    const second = await regenerateProfileSummary(g);
    const m2 = (await stat(profileSummaryPath())).mtimeMs;
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(m1).toBe(m2); // 未重写
  });

  it('图谱变化后重写，内容与图谱一致', async () => {
    const g = makeGraph([{ id: '天文', weight: 0.5 }]);
    await regenerateProfileSummary(g);
    const before = await readFile(profileSummaryPath(), 'utf-8');

    g.applySignal('天文', 'like'); // 权重变化 → 摘要应更新
    const changed = await regenerateProfileSummary(g);
    expect(changed).toBe(true);
    const after = await readFile(profileSummaryPath(), 'utf-8');
    expect(after).not.toBe(before);
    // 新摘要反映新权重：50% → 80%（0.5+1.0×0.3）
    expect(after).toContain('80%');
    // 仍是派生标记（无独立叙述）
    expect(after).toContain('本文件由用户兴趣图谱自动派生');
  });
});