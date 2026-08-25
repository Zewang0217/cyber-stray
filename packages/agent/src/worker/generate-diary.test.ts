/**
 * runDiaryWorker 端到端测试（#92 睡前任务，mock LLM）
 *
 * 覆盖：
 * - 有当天素材 → 生成性格化日记落盘 diary/YYYY-MM-DD.md
 * - 不同性格 → 生成 prompt 风格可感知差异（性格 diaryStyle 注入）
 * - 风格选项生效（具体风格覆盖性格模板）
 * - 今天无事（三段空）→ skipped，不落盘
 * - pushEnabled → 写 notifiable speak 记录
 * - 租户上下文清除（finally）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFile, access, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { useTempDataDir } from '../test/helpers.js';

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

vi.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: vi.fn(() => ({
    chat: vi.fn(() => ({ modelId: 'mock-model' })),
  })),
}));

import { generateText } from 'ai';
import { runDiaryWorker } from './generate-diary.js';

/** 让 generateText 返回固定叙述，并记录收到的 prompt */
function mockNarrative(text: string): { prompts: string[] } {
  const prompts: string[] = [];
  (generateText as ReturnType<typeof vi.fn>).mockImplementation(async (opts: { prompt?: string }) => {
    prompts.push(opts.prompt ?? '');
    return { text };
  });
  return { prompts };
}

/**
 * 让 generateText 按调用顺序返回多段叙述（#93：日记 + 梦境两次调用）。
 * 返回 { texts, prompts }：texts = 实际返回的叙述序列，prompts = 收到的 prompt 序列。
 */
function mockNarratives(texts: string[]): { texts: string[]; prompts: string[] } {
  const prompts: string[] = [];
  const returned: string[] = [];
  (generateText as ReturnType<typeof vi.fn>).mockImplementation(async (opts: { prompt?: string }) => {
    prompts.push(opts.prompt ?? '');
    const text = texts[returned.length] ?? '';
    returned.push(text);
    return { text };
  });
  return { texts: returned, prompts };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** 种当天足迹/兴趣/反馈素材 */
async function seedTodayData(dataDir: string, date: string): Promise<void> {
  const { mkdir, writeFile } = await import('fs/promises');
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    join(dataDir, 'wander-history.json'),
    JSON.stringify([
      { tool: 'search_web', thought: '搜索(量子计算)', timestamp: `${date}T10:00:00Z` },
    ]),
  );
  await writeFile(
    join(dataDir, 'interest-history.jsonl'),
    JSON.stringify({ timestamp: `${date}T10:00:00Z`, nodes: [{ id: '量子计算' }] }) + '\n',
  );
}

describe('runDiaryWorker 端到端', () => {
  let dataDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    const temp = useTempDataDir();
    dataDir = temp.dataDir;
    cleanup = temp.cleanup;
  });

  afterEach(() => cleanup());

  it('有当天素材 → 生成日记落盘 diary/YYYY-MM-DD.md', async () => {
    await seedTodayData(dataDir, '2026-08-20');
    mockNarrative('今天我逛到了量子计算的世界，好神奇！');

    const result = await runDiaryWorker({
      tenantId: 'alice',
      dataDir,
      petName: '小七',
      date: '2026-08-20',
      personality: 'curious',
    });

    expect(result.skipped).toBe(false);
    expect(result.file).toBe(join(dataDir, 'diary', '2026-08-20.md'));
    const md = await readFile(join(dataDir, 'diary', '2026-08-20.md'), 'utf-8');
    expect(md).toContain('# 日记 · 2026-08-20');
    expect(md).toContain('**小七** · 性格：好奇');
    expect(md).toContain('今天我逛到了量子计算的世界，好神奇！');
  });

  it('不同性格 → prompt 风格可感知差异（性格 diaryStyle 注入不同）', async () => {
    await seedTodayData(dataDir, '2026-08-20');
    const curious = mockNarrative('好奇日记');
    await runDiaryWorker({ tenantId: 'a', dataDir, petName: '小七', date: '2026-08-20', personality: 'curious' });
    const curiousPrompt = curious.prompts[0];

    const lazy = mockNarrative('慵懒日记');
    await runDiaryWorker({ tenantId: 'a', dataDir, petName: '小七', date: '2026-08-20', personality: 'lazy' });
    const lazyPrompt = lazy.prompts[0];

    expect(curiousPrompt).toContain('记录当天发现的趣闻与新兴趣');
    expect(lazyPrompt).toContain('慢悠悠地记几笔，随性带点吐槽');
    expect(curiousPrompt).not.toEqual(lazyPrompt);
  });

  it('风格选项生效：literary 覆盖性格模板', async () => {
    await seedTodayData(dataDir, '2026-08-20');
    const { prompts } = mockNarrative('文艺日记');
    await runDiaryWorker({
      tenantId: 'a',
      dataDir,
      petName: '小七',
      date: '2026-08-20',
      personality: 'curious',
      diaryStyle: 'literary',
    });
    const prompt = prompts[0];
    // 性格模板被覆盖，注入文艺语气
    expect(prompt).toMatch(/文艺|意象|抒情/);
  });

  it('今天无事（三段空）→ skipped，不落盘', async () => {
    mockNarrative('不会被调用');
    const result = await runDiaryWorker({
      tenantId: 'a',
      dataDir,
      petName: '小七',
      date: '2026-08-20',
      personality: 'curious',
    });
    expect(result.skipped).toBe(true);
    expect(await fileExists(join(dataDir, 'diary', '2026-08-20.md'))).toBe(false);
    expect(generateText).not.toHaveBeenCalled();
  });

  it('与日记同刻生成梦境：dreamFile 落盘 diary/dreams/YYYY-MM-DD.md（独立文件）', async () => {
    await seedTodayData(dataDir, '2026-08-20');
    mockNarratives(['日记正文', '我梦见自己变成了一束量子光。']);

    const result = await runDiaryWorker({
      tenantId: 'a',
      dataDir,
      petName: '小七',
      date: '2026-08-20',
      personality: 'curious',
    });

    expect(result.skipped).toBe(false);
    expect(result.dreamFile).toBe(join(dataDir, 'diary', 'dreams', '2026-08-20.md'));
    const dreamMd = await readFile(join(dataDir, 'diary', 'dreams', '2026-08-20.md'), 'utf-8');
    expect(dreamMd).toContain('# 梦境 · 2026-08-20');
    expect(dreamMd).toContain('我梦见自己变成了一束量子光。');
    // 日记与梦境两个独立文件
    const diaryMd = await readFile(join(dataDir, 'diary', '2026-08-20.md'), 'utf-8');
    expect(diaryMd).toContain('# 日记 · 2026-08-20');
    expect(diaryMd).toContain('日记正文');
  });

  it('梦境 prompt 基于当天真实兴趣/足迹（输入 → 输出关联，非通用文本）', async () => {
    await seedTodayData(dataDir, '2026-08-20');
    const { prompts } = mockNarratives(['日记正文', '梦境正文']);

    await runDiaryWorker({
      tenantId: 'a',
      dataDir,
      petName: '小七',
      date: '2026-08-20',
      personality: 'curious',
    });

    // 第二次 generateText 调用 = 梦境 prompt；必须包含当天种子数据
    expect(prompts).toHaveLength(2);
    const dreamPrompt = prompts[1]!;
    expect(dreamPrompt).toContain('量子计算');
    expect(dreamPrompt).toContain('搜索(量子计算)');
    // 梦境 prompt 是抽象联想指令（非日记复述）
    expect(dreamPrompt).toMatch(/抽象联想重构/);
    expect(dreamPrompt).not.toContain('写一篇日记');
  });

  it('仅反馈无兴趣/足迹 → 日记生成但当晚无梦（不生成梦境文件）', async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      join(dataDir, 'feedback.json'),
      JSON.stringify({
        feedbacks: [
          { id: 'f1', type: 'like', messageId: 'm1', timestamp: '2026-08-20T12:00:00Z', status: 'processed' },
        ],
        lastUpdated: '2026-08-20T12:00:00Z',
      }),
    );
    mockNarratives(['只有反馈的日记']);

    const result = await runDiaryWorker({
      tenantId: 'a',
      dataDir,
      petName: '小七',
      date: '2026-08-20',
      personality: 'curious',
    });

    expect(result.skipped).toBe(false);
    expect(result.file).toBe(join(dataDir, 'diary', '2026-08-20.md'));
    expect(result.dreamFile).toBeUndefined();
    expect(await fileExists(join(dataDir, 'diary', 'dreams', '2026-08-20.md'))).toBe(false);
  });

  it('pushEnabled → 写 notifiable speak 记录', async () => {
    await seedTodayData(dataDir, '2026-08-20');
    mockNarrative('日记正文');
    const result = await runDiaryWorker({
      tenantId: 'a',
      dataDir,
      petName: '小七',
      date: '2026-08-20',
      personality: 'curious',
      pushEnabled: true,
    });
    expect(result.pushed).toBe(true);
    const { readdir } = await import('fs/promises');
    const files = await readdir(join(dataDir, 'history'));
    expect(files.some((f) => f.startsWith('speaks-'))).toBe(true);
  });

  it('非法日记风格 → 显式抛错（禁兜底）', async () => {
    await expect(
      runDiaryWorker({
        tenantId: 'a',
        dataDir,
        petName: '小七',
        date: '2026-08-20',
        diaryStyle: 'grumpy' as never,
      }),
    ).rejects.toThrow(/非法日记风格/);
  });

  it('结束后租户上下文清除', async () => {
    await seedTodayData(dataDir, '2026-08-20');
    mockNarrative('x');
    await runDiaryWorker({ tenantId: 'a', dataDir, petName: '小七', date: '2026-08-20' });
    const { getTenantContext } = await import('../config.js');
    expect(getTenantContext()).toBeNull();
  });

  it('#96 日记写完触发表情包：memeEnabled=true 走生成（非致命，失败留痕）', async () => {
    await seedTodayData(dataDir, '2026-08-20');
    // 第三次 generateText = 表情包文案（mock 返回非法 JSON → 文案解析失败，
    // 验证触发链确实走到表情包步骤且不拖垮日记任务）
    mockNarratives(['日记正文', '梦境正文', '不是合法文案JSON']);
    const result = await runDiaryWorker({
      tenantId: 'a',
      dataDir,
      petName: '小七',
      date: '2026-08-20',
      personality: 'curious',
      memeEnabled: true,
    });
    // 日记与梦境仍成功落盘
    expect(result.file).toBe(join(dataDir, 'diary', '2026-08-20.md'));
    expect(result.dreamFile).toBe(join(dataDir, 'diary', 'dreams', '2026-08-20.md'));
    // 表情包触发链执行了（第三次 generateText 被调用 = 文案生成）
    expect(generateText).toHaveBeenCalledTimes(3);
    // 非致命：文案非法 → meme.failed 留痕，不抛错
    expect(result.meme?.status).toBe('failed');
    expect(result.meme?.reason).toMatch(/文案生成失败/);
  });

  it('#96 memeEnabled=false（默认）→ 不触发表情包（只 2 次 generateText）', async () => {
    await seedTodayData(dataDir, '2026-08-20');
    mockNarratives(['日记正文', '梦境正文']);
    const result = await runDiaryWorker({
      tenantId: 'a',
      dataDir,
      petName: '小七',
      date: '2026-08-20',
      personality: 'curious',
    });
    expect(result.meme).toBeUndefined();
    expect(generateText).toHaveBeenCalledTimes(2);
  });
});
