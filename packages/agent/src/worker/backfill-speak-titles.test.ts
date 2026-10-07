import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyTitlePlan, createTitlePlan } from './backfill-speak-titles.js';

const HISTORY_FILE = 'speaks-2026-10-06.jsonl';

describe('旧文章标题审阅与原子补全', () => {
  let dataDir: string;
  let path: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'title-backfill-'));
    await mkdir(join(dataDir, 'history'));
    path = join(dataDir, 'history', HISTORY_FILE);
    await writeFile(path, [
      JSON.stringify({ contentId: 'content-1', messageId: 'feishu-1',
        channelMessageIds: { telegram: 'tg-1' }, type: 'article',
        content: '旧文章的开场句很长。真正重要的是量子计算中的纠错。', title: '旧文章的开场句很长。真正重要的是量子计算中的纠错。',
        url: 'https://example.com/source', timestamp: '2026-10-06T10:00:00Z' }),
      JSON.stringify({ contentId: 'content-2', type: 'article',
        content: '已经有独立标题的正文。', title: '更值得关注的新发现', titleSource: 'react' }),
      JSON.stringify({ type: 'article', content: '日记正文', title: '日记正文', diary: true }),
      '',
    ].join('\n'));
  });
  afterEach(async () => { await rm(dataDir, { recursive: true, force: true }); });

  it('dry-run 不改历史；apply 只改标题并保留所有反馈关联字段', async () => {
    const before = await readFile(path, 'utf8');
    const plan = await createTitlePlan(dataDir, 'tenant-a', HISTORY_FILE, async (items) => {
      expect(items).toHaveLength(1);
      return ['量子纠错迎来关键一步'];
    });
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]?.excerpt).toContain('量子计算中的纠错');
    expect(await applyTitlePlan(dataDir, 'tenant-a', plan)).toBe(1);
    const [updated, react, diary] = (await readFile(path, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(updated).toMatchObject({ contentId: 'content-1', messageId: 'feishu-1',
      channelMessageIds: { telegram: 'tg-1' }, title: '量子纠错迎来关键一步',
      titleSource: 'backfill', url: 'https://example.com/source' });
    expect(updated.content).toBe('旧文章的开场句很长。真正重要的是量子计算中的纠错。');
    expect(react.title).toBe('更值得关注的新发现');
    expect(diary.title).toBe('日记正文');
  });

  it('拒绝对当天正在追加的历史做 dry-run', async () => {
    await expect(createTitlePlan(dataDir, 'tenant-a', 'speaks-2026-10-07.jsonl', async () => []))
      .rejects.toThrow(/已结束的历史日期/);
  });

  it('历史变化或标题非法时拒绝应用，文件字节不变', async () => {
    const plan = await createTitlePlan(dataDir, 'tenant-a', HISTORY_FILE, async () => ['量子纠错迎来关键一步']);
    await writeFile(path, `${await readFile(path, 'utf8')}\n`);
    const changed = await readFile(path, 'utf8');
    await expect(applyTitlePlan(dataDir, 'tenant-a', plan)).rejects.toThrow(/已变化/);
    expect(await readFile(path, 'utf8')).toBe(changed);
    await expect(applyTitlePlan(dataDir, 'tenant-b', plan)).rejects.toThrow(/租户不匹配/);
    expect(await readFile(path, 'utf8')).toBe(changed);
  });
});
