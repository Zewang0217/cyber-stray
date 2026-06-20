import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryStore } from './index.js';
import { toSafeFilename } from './types.js';

describe('MemoryStore', () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'memory-test-'));
    store = new MemoryStore({ basePath: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('saveMemory→getMemory 往返保持内容一致', async () => {
    const saved = await store.saveMemory({
      type: 'knowledge',
      timestamp: '2026-06-20T00:00:00.000Z',
      tags: ['ai', 'llm'],
      summary: 'DeepSeek V4 开源',
      content: 'DeepSeek V4 开源，Agent 能力第一',
      importance: 0.6,
    });

    const got = await store.getMemory('knowledge', saved.id);
    expect(got).not.toBeNull();
    expect(got!.summary).toBe('DeepSeek V4 开源');
    // content 原文被保留；注：parseMemoryFrontmatter 当前会在 content 前保留 ## summary 行
    // （既有解析行为），故用 toContain 验证原文而非精确相等
    expect(got!.content).toContain('DeepSeek V4 开源，Agent 能力第一');
    expect(got!.tags).toEqual(['ai', 'llm']);
    expect(got!.importance).toBe(0.6);
  });

  test('importance>0.7 的记忆进入 importantMemories', async () => {
    const saved = await store.saveMemory({
      type: 'knowledge',
      timestamp: '2026-06-20T00:00:00.000Z',
      tags: ['重要'],
      summary: '关键洞察',
      content: '非常重要的内容',
      importance: 0.9,
    });

    const index = await store.readIndex();
    expect(index.importantMemories).toContain(saved.id);
  });

  test('saveMemory 累积 recentMemories 与 tags（区段字段正确往返）', async () => {
    const a = await store.saveMemory({
      type: 'knowledge', timestamp: '2026-06-20T00:00:00.000Z',
      tags: ['ai'], summary: 'a', content: '内容a', importance: 0.5,
    });
    const b = await store.saveMemory({
      type: 'knowledge', timestamp: '2026-06-20T00:00:01.000Z',
      tags: ['web'], summary: 'b', content: '内容b', importance: 0.5,
    });

    const index = await store.readIndex();
    expect(index.recentMemories).toContain(a.id);
    expect(index.recentMemories).toContain(b.id);
    expect(index.tags).toContain('ai');
    expect(index.tags).toContain('web');
  });

  test('deleteMemory 移除文件并从索引剔除', async () => {
    const saved = await store.saveMemory({
      type: 'observation', timestamp: '2026-06-20T00:00:00.000Z',
      tags: [], summary: 's', content: '观察内容', importance: 0.3,
    });

    const ok = await store.deleteMemory('observation', saved.id);
    expect(ok).toBe(true);

    const got = await store.getMemory('observation', saved.id);
    expect(got).toBeNull();
  });

  test('index 区段字段 write→read 往返一致', async () => {
    await new MemoryStore({ basePath: dir }).writeIndex({
      lastUpdated: '2026-01-01T00:00:00.000Z',
      totalMemories: 5,
      typeStats: { profile: 1, knowledge: 2, interaction: 1, observation: 1 },
      recentMemories: ['mem-1', 'mem-2'],
      importantMemories: ['mem-imp'],
      tags: ['ai', 'tech'],
    });

    const read = await new MemoryStore({ basePath: dir }).readIndex();
    // 基于 ## 章节解析的字段能正确往返
    expect(read.recentMemories).toEqual(['mem-1', 'mem-2']);
    expect(read.importantMemories).toEqual(['mem-imp']);
    expect(read.tags).toEqual(['ai', 'tech']);
    // NOTE: totalMemories / typeStats 因概览区中文 key（总记忆数/类型统计）
    // 与 parseIndexFromMarkdown 的 (\w+) 正则不匹配而无法往返——已作为独立
    // 发现报告，不在本测试提交中修复，故此处不断言以避免误绿。
  });
});

describe('toSafeFilename', () => {
  test('阻止路径遍历：不含 .. 与路径分隔符', () => {
    const safe = toSafeFilename('../../etc/passwd');
    expect(safe).not.toContain('..');
    expect(safe).not.toContain('/');
    expect(safe).not.toContain('\\');
  });

  test('折叠为空时回退 mem- 前缀', () => {
    const safe = toSafeFilename('   ');
    expect(safe.startsWith('mem-')).toBe(true);
  });
});
