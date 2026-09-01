/**
 * 好奇图谱骨架测试（S1 #150）
 *
 * 覆盖：默认骨架、save→load round-trip、schema 校验（脏数据抛错）。
 */

import { describe, it, expect, afterEach } from 'vitest';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import {
  createDefaultCuriosityData,
  loadCuriosityGraph,
  saveCuriosityGraph,
  CuriosityGraphDataSchema,
} from './curiosity-interests.js';
import { useTempDataDir } from '../test/helpers.js';

describe('CuriosityGraph 骨架（S1 #150）', () => {
  let cleanup: () => void;
  afterEach(() => cleanup?.());

  it('默认骨架：空节点数组', () => {
    const data = createDefaultCuriosityData();
    expect(data.version).toBe(1);
    expect(data.nodes).toEqual([]);
    expect(CuriosityGraphDataSchema.safeParse(data).success).toBe(true);
  });

  it('save → load round-trip（S4 接入形态）', async () => {
    const h = useTempDataDir();
    cleanup = h.cleanup;

    const now = new Date().toISOString();
    await saveCuriosityGraph({
      version: 1,
      lastUpdated: now,
      nodes: [
        {
          id: '天文/黑洞',
          path: '天文/黑洞',
          parent: '天文',
          exploreCount: 3,
          selfInterest: 0.8,
          source: 'reflection',
          lastExplored: now,
        },
      ],
    });

    const loaded = await loadCuriosityGraph();
    expect(loaded.nodes).toHaveLength(1);
    expect(loaded.nodes[0]!.exploreCount).toBe(3);
    expect(loaded.nodes[0]!.selfInterest).toBe(0.8);
    expect(loaded.nodes[0]!.parent).toBe('天文');
  });

  it('文件不存在 → 返回空骨架（合法，不抛错）', async () => {
    const h = useTempDataDir();
    cleanup = h.cleanup;
    expect(existsSync(join(h.dataDir, 'curiosity-interests.json'))).toBe(false);
    const loaded = await loadCuriosityGraph();
    expect(loaded.nodes).toEqual([]);
  });

  it('脏数据 → schema 校验抛错（D-09 不兜底）', async () => {
    const h = useTempDataDir();
    cleanup = h.cleanup;
    await writeFile(
      join(h.dataDir, 'curiosity-interests.json'),
      JSON.stringify({ version: 2, lastUpdated: new Date().toISOString(), nodes: [] }),
      'utf-8',
    );
    await expect(loadCuriosityGraph()).rejects.toThrow('schema 校验失败');
  });
});