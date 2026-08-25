/**
 * 日记生成器测试（#92）
 *
 * 覆盖：
 * - 纯函数：buildDiaryPrompt（事实 + 性格模板 + 风格选择 → prompt，有则写无则跳过）
 * - 纯函数：renderDiaryMarkdown（叙述 → markdown 结构，含元信息头）
 * - I/O：collectDiaryData（当天足迹/兴趣/反馈，缺失 = 合法空态）
 * - hasDiaryContent（三段全空 → 跳过）
 * - recordDiaryForPush（notifiable speak 记录）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { useTempDataDir } from '../../test/helpers.js';
import { getPersonality } from '@cyber-stray/shared';
import {
  buildDiaryPrompt,
  collectDiaryData,
  diaryFilePath,
  hasDiaryContent,
  recordDiaryForPush,
  renderDiaryMarkdown,
  type DiaryData,
} from './diary-generator.js';

/** 构造有内容的当天数据（各段非空） */
function makeFullData(overrides: Partial<DiaryData> = {}): DiaryData {
  return {
    date: '2026-08-20',
    petName: '小七',
    footprint: [
      { tool: 'search_web', thought: '搜索(量子计算)', timestamp: '2026-08-20T10:00:00Z' },
      { tool: 'browse_page', url: 'https://example.com/q', timestamp: '2026-08-20T10:05:00Z' },
    ],
    interests: ['量子计算', '城市漫步'],
    feedback: ['赞了（om-1）', '顶了话题'],
    ...overrides,
  };
}

describe('buildDiaryPrompt（纯函数）', () => {
  it('包含性格写照 + 风格 prompt + 各内容段', () => {
    const prompt = buildDiaryPrompt(makeFullData(), getPersonality('curious'), 'personality');
    expect(prompt).toContain('小七');
    expect(prompt).toContain('好奇性格的赛博宠物');
    expect(prompt).toContain(getPersonality('curious').diaryStyle);
    expect(prompt).toContain('## 今天游荡足迹');
    expect(prompt).toContain('## 今天在意的兴趣');
    expect(prompt).toContain('## 主人今天给我的反馈');
  });

  it('风格选择：具体风格覆盖性格模板', () => {
    const personalityPrompt = buildDiaryPrompt(makeFullData(), getPersonality('lazy'), 'personality');
    const literaryPrompt = buildDiaryPrompt(makeFullData(), getPersonality('lazy'), 'literary');
    expect(personalityPrompt).toContain(getPersonality('lazy').diaryStyle);
    expect(literaryPrompt).not.toContain(getPersonality('lazy').diaryStyle);
    expect(literaryPrompt).toMatch(/文艺|意象|抒情/);
  });

  it('有则写无则跳过：空段不进入 prompt', () => {
    const data = makeFullData({ footprint: [], interests: [], feedback: [] });
    const prompt = buildDiaryPrompt(data, getPersonality('curious'), 'personality');
    expect(prompt).not.toContain('## 今天游荡足迹');
    expect(prompt).not.toContain('## 今天在意的兴趣');
    expect(prompt).not.toContain('## 主人今天给我的反馈');
  });
});

describe('renderDiaryMarkdown（纯函数）', () => {
  it('生成 标题 + 元信息头 + 叙述 的 markdown 结构', () => {
    const md = renderDiaryMarkdown('今天我去了量子世界…', {
      date: '2026-08-20',
      petName: '小七',
      personalityName: '好奇',
      styleLabel: '随性格（好奇）',
    });
    expect(md).toContain('# 日记 · 2026-08-20');
    expect(md).toContain('**小七** · 性格：好奇 · 风格：随性格（好奇）');
    expect(md).toContain('今天我去了量子世界…');
  });
});

describe('collectDiaryData（I/O，租户目录隔离）', () => {
  let dataDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const temp = useTempDataDir();
    dataDir = temp.dataDir;
    cleanup = temp.cleanup;
  });

  afterEach(() => cleanup());

  it('缺失全部数据源 → 合法空态（空数组，非报错）', async () => {
    const data = await collectDiaryData('2026-08-20', '小七');
    expect(data).toEqual({ date: '2026-08-20', petName: '小七', footprint: [], interests: [], feedback: [] });
    expect(hasDiaryContent(data)).toBe(false);
  });

  it('只取当天的足迹（隔天步骤不进日记）', async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      join(dataDir, 'wander-history.json'),
      JSON.stringify([
        { tool: 'search_web', thought: '今天', timestamp: '2026-08-20T09:00:00Z' },
        { tool: 'browse_page', url: 'https://x.com', timestamp: '2026-08-19T09:00:00Z' },
      ]),
    );
    const data = await collectDiaryData('2026-08-20', '小七');
    expect(data.footprint).toHaveLength(1);
    expect(data.footprint[0]).toMatchObject({ tool: 'search_web' });
  });

  it('当天兴趣快照去重为兴趣列表', async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      join(dataDir, 'interest-history.jsonl'),
      [
        JSON.stringify({ timestamp: '2026-08-20T10:00:00Z', nodes: [{ id: '量子计算' }, { id: '城市漫步' }] }),
        JSON.stringify({ timestamp: '2026-08-20T11:00:00Z', nodes: [{ id: '量子计算' }] }),
        JSON.stringify({ timestamp: '2026-08-19T10:00:00Z', nodes: [{ id: '旧话题' }] }),
      ].join('\n') + '\n',
    );
    const data = await collectDiaryData('2026-08-20', '小七');
    expect(data.interests.sort()).toEqual(['城市漫步', '量子计算']);
  });

  it('当天反馈进入日记素材', async () => {
    await mkdir(join(dataDir, 'feedback'), { recursive: true });
    await writeFile(
      join(dataDir, 'feedback.json'),
      JSON.stringify({
        feedbacks: [
          { id: 'a', type: 'like', timestamp: '2026-08-20T09:00:00Z', status: 'processed' },
          { id: 'b', type: 'boost', timestamp: '2026-08-19T09:00:00Z', status: 'processed' },
        ],
        lastUpdated: '2026-08-20T09:00:00Z',
      }),
    );
    const data = await collectDiaryData('2026-08-20', '小七');
    expect(data.feedback).toHaveLength(1);
    expect(data.feedback[0]).toContain('赞了');
  });
});

describe('落盘 + 推送记录', () => {
  let dataDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const temp = useTempDataDir();
    dataDir = temp.dataDir;
    cleanup = temp.cleanup;
  });

  afterEach(() => cleanup());

  it('diaryFilePath 落在租户目录 diary/YYYY-MM-DD.md', () => {
    expect(diaryFilePath('2026-08-20')).toBe(join(dataDir, 'diary', '2026-08-20.md'));
  });

  it('recordDiaryForPush 写 notifiable speak 记录（pushed=false, gated=false, diary=true）', async () => {
    await mkdir(dataDir, { recursive: true });
    const { title } = await recordDiaryForPush('# 日记 · 2026-08-20\n\n今天去了量子世界');
    expect(title.length).toBeGreaterThan(0);

    const { readFile, readdir } = await import('fs/promises');
    const files = await readdir(join(dataDir, 'history'));
    expect(files.some((f) => f.startsWith('speaks-'))).toBe(true);
    const file = files.find((f) => f.startsWith('speaks-'))!;
    const line = JSON.parse((await readFile(join(dataDir, 'history', file), 'utf-8')).trim());
    expect(line.diary).toBe(true);
    expect(line.pushed).toBe(false);
    expect(line.gated).toBe(false);
    expect(line.planLimited).toBe(false);
    expect(line.content).toContain('量子世界');
  });
});
