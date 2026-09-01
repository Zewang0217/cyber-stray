/**
 * 用户画像目录化迁移测试（S1 #150）
 *
 * 覆盖：扁平→一级节点映射、likes/dislikes 消解（精确/包含匹配 + unmapped 不丢）、
 * slim 画像（无 likes/dislikes 字段）、占位文件就位、幂等重跑（already-migrated）。
 *
 * migrateUserProfile(dataDir) 显式接收目录；用 useTempDataDir 提供隔离目录 + 自动清理。
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { migrateUserProfile } from './migrate-user-profile.js';
import { useTempDataDir } from '../test/helpers.js';

async function makeLegacyData(dataDir: string, overrides?: { dislikes?: string[] }): Promise<void> {
  await mkdir(join(dataDir, 'memory'), { recursive: true });

  await writeFile(
    join(dataDir, 'interests.json'),
    JSON.stringify({
      version: 1,
      lastUpdated: '2026-08-15T00:00:00.000Z',
      nodes: [
        {
          id: '天文',
          weight: 0.6,
          source: 'feedback',
          createdAt: '2026-08-01T00:00:00.000Z',
          lastReinforced: '2026-08-15T00:00:00.000Z',
          reinforceCount: 3,
        },
        {
          id: '科技',
          weight: 0.5,
          source: 'default',
          createdAt: '2026-08-01T00:00:00.000Z',
          lastReinforced: '2026-08-01T00:00:00.000Z',
          reinforceCount: 0,
        },
      ],
    }),
    'utf-8',
  );

  await writeFile(
    join(dataDir, 'memory/user-profile.json'),
    JSON.stringify({
      likes: ['天文', '有故事性的天文发现'],
      dislikes: overrides?.dislikes ?? ['天文'],
      feedbackCount: 4,
      sampleCount: 4,
      confidence: 4 / 14,
      lastProfileUpdateAt: null,
    }),
    'utf-8',
  );
}

describe('migrateUserProfile（S1 #150）', () => {
  let cleanup: () => void;
  afterEach(() => cleanup?.());

  it('扁平图谱→一级节点、likes/dislikes 消解为 exemplars、画像 slim', async () => {
    const h = useTempDataDir();
    cleanup = h.cleanup;
    await makeLegacyData(h.dataDir);

    const report = await migrateUserProfile(h.dataDir);

    expect(report.status).toBe('migrated');
    expect(report.skipped).toBe(false);

    // 图谱 v2：一级节点 path=id，来源保留，无 parent（根）
    const graph = JSON.parse(
      await readFile(join(h.dataDir, 'user-profile/user-interests.json'), 'utf-8'),
    ) as {
      version: number;
      nodes: Array<{
        id: string;
        path?: string;
        parent?: string;
        source: string;
        exemplars?: string[];
        negativeExemplars?: string[];
      }>;
    };
    expect(graph.version).toBe(2);
    expect(graph.nodes).toHaveLength(2);
    const tianwen = graph.nodes.find((n) => n.id === '天文')!;
    expect(tianwen.path).toBe('天文');
    expect(tianwen.parent).toBeUndefined();
    expect(tianwen.source).toBe('feedback'); // 原来源保留
    expect(tianwen.exemplars).toEqual(['天文', '有故事性的天文发现']);
    expect(tianwen.negativeExemplars).toEqual(['天文']);
    const keji = graph.nodes.find((n) => n.id === '科技')!;
    expect(keji.path).toBe('科技');
    expect(keji.exemplars).toBeUndefined();

    // slim 画像：无 likes/dislikes 字段（单写者纪律）
    const profile = JSON.parse(
      await readFile(join(h.dataDir, 'memory/user-profile.json'), 'utf-8'),
    ) as Record<string, unknown>;
    expect('likes' in profile).toBe(false);
    expect('dislikes' in profile).toBe(false);
    expect(profile.sampleCount).toBe(4); // 阻尼参数保留

    // 报告统计
    expect(report.stats.sourceInterests).toBe(2);
    expect(report.stats.likesMapped).toBe(2);
    expect(report.stats.dislikesMapped).toBe(1);
    expect(report.stats.unmappedLikes).toEqual([]);
    expect(report.stats.unmappedDislikes).toEqual([]);

    // 目录四模块 + 好奇骨架 + 报告就位
    for (const f of ['identity.json', 'settings.json', 'profile-summary.md', 'migration-report.json']) {
      expect(existsSync(join(h.dataDir, 'user-profile', f))).toBe(true);
    }
    expect(existsSync(join(h.dataDir, 'curiosity-interests.json'))).toBe(true);

    // 旧文件保留（备份语义，可回放）
    expect(existsSync(join(h.dataDir, 'interests.json'))).toBe(true);

    // 好奇骨架 = 空节点数组
    const curiosity = JSON.parse(
      await readFile(join(h.dataDir, 'curiosity-interests.json'), 'utf-8'),
    ) as { version: number; nodes: unknown[] };
    expect(curiosity.version).toBe(1);
    expect(curiosity.nodes).toEqual([]);
  });

  it('未命中的反馈原文进 unmapped（不静默丢弃）', async () => {
    const h = useTempDataDir();
    cleanup = h.cleanup;
    await makeLegacyData(h.dataDir, { dislikes: ['量子力学'] });

    const report = await migrateUserProfile(h.dataDir);

    expect(report.stats.dislikesTotal).toBe(1);
    expect(report.stats.dislikesMapped).toBe(0);
    expect(report.stats.unmappedDislikes).toEqual(['量子力学']);
    expect(report.stats.unmappedLikes).toEqual([]);
  });

  it('幂等：重跑跳过核心迁移（already-migrated，图谱不覆盖）', async () => {
    const h = useTempDataDir();
    cleanup = h.cleanup;
    await makeLegacyData(h.dataDir);
    await migrateUserProfile(h.dataDir);

    const graphPath = join(h.dataDir, 'user-profile/user-interests.json');
    const before = await readFile(graphPath, 'utf-8');
    const report2 = await migrateUserProfile(h.dataDir);

    expect(report2.status).toBe('already-migrated');
    expect(report2.skipped).toBe(true);
    expect(await readFile(graphPath, 'utf-8')).toBe(before);

    // 占位文件不重复创建
    const report3 = await migrateUserProfile(h.dataDir);
    expect(report3.createdFiles.filter((f) => f.includes('identity.json'))).toEqual([]);
  });

  it('无旧图谱/画像的裸目录：空图谱 + 占位文件就位（新租户冷启动）', async () => {
    const h = useTempDataDir();
    cleanup = h.cleanup;

    const report = await migrateUserProfile(h.dataDir);

    expect(report.status).toBe('migrated');
    const graph = JSON.parse(
      await readFile(join(h.dataDir, 'user-profile/user-interests.json'), 'utf-8'),
    ) as { version: number; nodes: unknown[] };
    expect(graph.version).toBe(2);
    expect(graph.nodes).toEqual([]);
    expect(report.stats.sourceInterests).toBe(0);
    expect(existsSync(join(h.dataDir, 'user-profile/identity.json'))).toBe(true);
  });
});