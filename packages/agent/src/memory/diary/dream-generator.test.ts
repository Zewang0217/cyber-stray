/**
 * 梦境生成器测试（#93）
 *
 * 覆盖：
 * - buildDreamPrompt（纯函数）：兴趣/足迹作为意象原料真实进入 prompt（输入 → 输出关联）；
 *   有则写无则跳过；抽象联想指令（非事实复述）
 * - renderDreamMarkdown（纯函数）：梦境 markdown 结构（标题/元信息头），与日记文件分离
 * - hasDreamContent：素材判定（反馈不进梦境）
 * - dreamFilePath / writeDreamMarkdown：独立目录 diary/dreams/ 落盘（租户隔离）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { access, readFile } from 'fs/promises';
import { join } from 'path';
import { useTempDataDir } from '../../test/helpers.js';
import { getPersonality } from '@cyber-stray/shared';
import type { DiaryData } from './diary-generator.js';
import {
  buildDreamPrompt,
  dreamFilePath,
  hasDreamContent,
  renderDreamMarkdown,
  writeDreamMarkdown,
} from './dream-generator.js';

/** 构造有当天素材的数据（兴趣 + 足迹） */
function makeData(overrides: Partial<DiaryData> = {}): DiaryData {
  return {
    date: '2026-08-20',
    petName: '小七',
    footprint: [
      {
        tool: 'search_web',
        thought: '搜索(量子计算)',
        url: 'https://example.com/quantum',
        timestamp: '2026-08-20T10:00:00Z',
      },
    ],
    interests: ['量子计算', '折纸'],
    feedback: ['赞了（msg-1）'],
    ...overrides,
  };
}

describe('buildDreamPrompt（纯函数）', () => {
  it('兴趣/足迹作为意象原料真实进入 prompt（输入 → 输出关联）', () => {
    const prompt = buildDreamPrompt(makeData(), getPersonality('curious'));
    expect(prompt).toContain('量子计算');
    expect(prompt).toContain('折纸');
    expect(prompt).toContain('搜索(量子计算)');
    // 性格梦境风格注入
    expect(prompt).toContain('把白天的兴趣碎片联想成奇妙的探索梦');
  });

  it('抽象联想指令：显式禁止复述事实', () => {
    const prompt = buildDreamPrompt(makeData(), getPersonality('curious'));
    expect(prompt).toMatch(/抽象联想重构/);
    expect(prompt).toMatch(/不要复述白天的真实经历/);
    expect(prompt).toMatch(/150–300 字/);
  });

  it('有则写无则跳过：只感兴趣 → 无足迹段', () => {
    const prompt = buildDreamPrompt(
      makeData({ footprint: [], feedback: [] }),
      getPersonality('curious'),
    );
    expect(prompt).toContain('在意的兴趣：');
    expect(prompt).toContain('量子计算');
    expect(prompt).not.toContain('游荡的片段：');
  });

  it('只有足迹 → 无兴趣段', () => {
    const prompt = buildDreamPrompt(
      makeData({ interests: [], feedback: [] }),
      getPersonality('curious'),
    );
    expect(prompt).toContain('游荡的片段：');
    expect(prompt).not.toContain('在意的兴趣：');
  });

  it('反馈不进梦境 prompt（梦是自己见闻的重构，不是社交总结）', () => {
    const prompt = buildDreamPrompt(makeData(), getPersonality('curious'));
    expect(prompt).not.toContain('赞了');
    expect(prompt).not.toContain('主人');
  });

  it('不同性格 → 梦境风格可感知差异（dreamStyle 注入不同）', () => {
    const curious = buildDreamPrompt(makeData(), getPersonality('curious'));
    const lazy = buildDreamPrompt(makeData(), getPersonality('lazy'));
    expect(curious).toContain('把白天的兴趣碎片联想成奇妙的探索梦');
    expect(lazy).toContain('安静慵懒的梦');
    expect(curious).not.toEqual(lazy);
  });
});

describe('hasDreamContent（素材判定）', () => {
  it('兴趣或足迹任一非空 = 有梦', () => {
    expect(hasDreamContent(makeData())).toBe(true);
    expect(hasDreamContent(makeData({ footprint: [] }))).toBe(true);
    expect(hasDreamContent(makeData({ interests: [] }))).toBe(true);
  });

  it('两者皆空 = 无梦（即使有反馈——反馈不进梦境素材）', () => {
    expect(
      hasDreamContent(makeData({ footprint: [], interests: [], feedback: ['赞了（msg-1）'] })),
    ).toBe(false);
  });
});

describe('renderDreamMarkdown（纯函数）', () => {
  it('梦境 markdown 结构：标题 + 元信息头 + 叙述，与日记文件分离', () => {
    const md = renderDreamMarkdown('我梦见自己变成了一束量子光。', {
      date: '2026-08-20',
      petName: '小七',
      personalityName: '好奇',
    });
    expect(md).toContain('# 梦境 · 2026-08-20');
    expect(md).toContain('**小七** · 性格：好奇 · 睡眠中的梦');
    expect(md).toContain('我梦见自己变成了一束量子光。');
    // 不是日记（独立叙事契约）
    expect(md).not.toContain('# 日记');
  });
});

describe('落盘（I/O，租户目录隔离）', () => {
  let dataDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const temp = useTempDataDir();
    dataDir = temp.dataDir;
    cleanup = temp.cleanup;
  });

  afterEach(() => cleanup());

  it('dreamFilePath 指向 diary/dreams/YYYY-MM-DD.md（与日记同根、独立文件）', () => {
    // useTempDataDir 设置 DATA_DIR，getDataPath 锚定该目录
    expect(dreamFilePath('2026-08-20')).toBe(join(dataDir, 'diary', 'dreams', '2026-08-20.md'));
  });

  it('writeDreamMarkdown 原子落盘到 diary/dreams/', async () => {
    const file = await writeDreamMarkdown('2026-08-20', '# 梦境 · 2026-08-20\n\n正文');
    expect(file).toBe(join(dataDir, 'diary', 'dreams', '2026-08-20.md'));
    await access(file);
    expect(await readFile(file, 'utf-8')).toContain('正文');
    // 不产生日记文件（两个文件分离）
    await expect(access(join(dataDir, 'diary', '2026-08-20.md'))).rejects.toThrow();
  });
});
