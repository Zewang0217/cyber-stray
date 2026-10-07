import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyTitlePlan, applyOverlayTitlePlan, createOverlayTitlePlan, createTitlePlan } from './backfill-speak-titles.js';

const HISTORY_FILE = 'speaks-2026-10-06.jsonl';

describe('旧文章与分享标题审阅及原子补全', () => {
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
      JSON.stringify({ contentId: 'share-1', messageId: 'feishu-share-1', type: 'share',
        content: '喵！今天本来在 AI 的巷子闲逛，结果发现一个有趣研究。https://example.com/research',
        title: '喵！今天本来在 AI 的巷子闲逛，结果发现一个有趣研究。',
        url: 'https://example.com/research' }),
      JSON.stringify({ type: 'share', content: '已有编辑标题的分享 https://example.com',
        title: '分享里的真正发现' }),
      JSON.stringify({ type: 'nonsense', content: '喵！', title: '喵！' }),
      JSON.stringify({ type: 'article', content: '日记正文', title: '日记正文', diary: true }),
      '',
    ].join('\n'));
  });
  afterEach(async () => { await rm(dataDir, { recursive: true, force: true }); });

  it('dry-run 不改历史；apply 只改标题并保留所有反馈关联字段', async () => {
    const before = await readFile(path, 'utf8');
    const plan = await createTitlePlan(dataDir, 'tenant-a', HISTORY_FILE, async (items) => {
      expect(items.map((item) => item.type)).toEqual(['article', 'share']);
      return ['量子纠错迎来关键一步', '小黑猫撞见 AI 新研究'];
    });
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(plan.changes).toHaveLength(2);
    expect(plan.changes[0]?.excerpt).toContain('量子计算中的纠错');
    expect(await applyTitlePlan(dataDir, 'tenant-a', plan)).toBe(2);
    const [updated, react, share, editedShare, nonsense, diary] =
      (await readFile(path, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(updated).toMatchObject({ contentId: 'content-1', messageId: 'feishu-1',
      channelMessageIds: { telegram: 'tg-1' }, title: '量子纠错迎来关键一步',
      titleSource: 'backfill', url: 'https://example.com/source' });
    expect(updated.content).toBe('旧文章的开场句很长。真正重要的是量子计算中的纠错。');
    expect(react.title).toBe('更值得关注的新发现');
    expect(share).toMatchObject({ contentId: 'share-1', messageId: 'feishu-share-1',
      title: '小黑猫撞见 AI 新研究', titleSource: 'backfill', url: 'https://example.com/research' });
    expect(editedShare.title).toBe('分享里的真正发现');
    expect(nonsense.title).toBe('喵！');
    expect(diary.title).toBe('日记正文');
  });

  it('拒绝对当天正在追加的历史做 dry-run', async () => {
    await expect(createTitlePlan(dataDir, 'tenant-a', 'speaks-2026-10-07.jsonl', async () => []))
      .rejects.toThrow(/已结束的历史日期/);
  });

  it('历史变化或标题非法时拒绝应用，文件字节不变', async () => {
    const plan = await createTitlePlan(dataDir, 'tenant-a', HISTORY_FILE,
      async () => ['量子纠错迎来关键一步', '小黑猫撞见 AI 新研究']);
    await writeFile(path, `${await readFile(path, 'utf8')}\n`);
    const changed = await readFile(path, 'utf8');
    await expect(applyTitlePlan(dataDir, 'tenant-a', plan)).rejects.toThrow(/已变化/);
    expect(await readFile(path, 'utf8')).toBe(changed);
    await expect(applyTitlePlan(dataDir, 'tenant-b', plan)).rejects.toThrow(/租户不匹配/);
    expect(await readFile(path, 'utf8')).toBe(changed);
  });

  it('当天 overlay 只写 sidecar；apply 后 JSONL 可继续追加且新记录完整保留', async () => {
    const todayFile = 'speaks-2026-10-07.jsonl';
    const todayPath = join(dataDir, 'history', todayFile);
    const id = 'aaaaaaaa-0000-4000-8000-000000000001';
    const first = { contentId: id, type: 'share', content: '喵！今天在 AI 巷子发现新研究。',
      title: '喵！今天在 AI 巷子发现新研究。', timestamp: '2026-10-07T08:00:00Z' };
    await writeFile(todayPath, `${JSON.stringify(first)}\n`);
    const before = await readFile(todayPath, 'utf8');
    const plan = await createOverlayTitlePlan(dataDir, 'tenant-a', todayFile,
      async () => ['小黑猫撞见 AI 新研究']);
    expect(plan.changes).toHaveLength(1);
    expect(await readFile(todayPath, 'utf8')).toBe(before);
    const appended = { contentId: 'bbbbbbbb-0000-0000-0000-000000000002',
      type: 'nonsense', content: '喵。', timestamp: '2026-10-07T09:00:00Z' };
    await writeFile(todayPath, `${before}${JSON.stringify(appended)}\n`);
    await expect(applyOverlayTitlePlan(dataDir, 'tenant-a', plan)).resolves.toBe(1);
    expect(await readFile(todayPath, 'utf8')).toBe(`${before}${JSON.stringify(appended)}\n`);
    const overlay = JSON.parse(await readFile(join(dataDir, 'history', 'title-overrides.json'), 'utf8'));
    expect(overlay.entries[id]).toMatchObject({ title: '小黑猫撞见 AI 新研究',
      sourceType: 'share', oldTitle: first.title, titleSourceAbsent: true,
      timestamp: first.timestamp });
  });

  it('当天候选无稳定 UUID 时拒绝生成计划，不写 sidecar', async () => {
    const todayFile = 'speaks-2026-10-07.jsonl';
    await writeFile(join(dataDir, 'history', todayFile), JSON.stringify({
      type: 'share', content: '开场句。', title: '开场句。', timestamp: '2026-10-07T08:00:00Z',
    }) + '\n');
    await expect(createOverlayTitlePlan(dataDir, 'tenant-a', todayFile, async () => ['独立短标题']))
      .rejects.toThrow(/contentId/);
  });

  it('计划来源正文变化则拒绝 overlay，当前 JSONL 和 sidecar 都不改', async () => {
    const todayFile = 'speaks-2026-10-07.jsonl';
    const todayPath = join(dataDir, 'history', todayFile);
    const item = { contentId: 'aaaaaaaa-0000-4000-8000-000000000001', type: 'share',
      content: '喵！发现了新研究。', title: '喵！发现了新研究。', timestamp: '2026-10-07T08:00:00Z' };
    await writeFile(todayPath, `${JSON.stringify(item)}\n`);
    const plan = await createOverlayTitlePlan(dataDir, 'tenant-a', todayFile,
      async () => ['小黑猫发现新研究']);
    const changed = `${JSON.stringify({ ...item, content: '喵！发现了另一篇研究。' })}\n`;
    await writeFile(todayPath, changed);
    await expect(applyOverlayTitlePlan(dataDir, 'tenant-a', plan)).rejects.toThrow(/前缀/);
    expect(await readFile(todayPath, 'utf8')).toBe(changed);
    await expect(readFile(join(dataDir, 'history', 'title-overrides.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('仅允许源文件后追加；非目标旧行变化也拒绝覆盖计划', async () => {
    const todayFile = 'speaks-2026-10-07.jsonl';
    const todayPath = join(dataDir, 'history', todayFile);
    const target = { contentId: 'aaaaaaaa-0000-4000-8000-000000000001', type: 'share',
      content: '喵！发现了新研究。', title: '喵！发现了新研究。', timestamp: '2026-10-07T08:00:00Z' };
    const other = { type: 'nonsense', content: '喵。', timestamp: '2026-10-07T08:05:00Z' };
    await writeFile(todayPath, `${JSON.stringify(target)}\n${JSON.stringify(other)}\n`);
    const plan = await createOverlayTitlePlan(dataDir, 'tenant-a', todayFile,
      async () => ['小黑猫发现新研究']);
    await writeFile(todayPath, `${JSON.stringify(target)}\n${JSON.stringify({ ...other, content: '汪。' })}\n`);
    await expect(applyOverlayTitlePlan(dataDir, 'tenant-a', plan)).rejects.toThrow(/前缀/);
    await expect(readFile(join(dataDir, 'history', 'title-overrides.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
});
