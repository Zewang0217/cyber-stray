/**
 * MemoryConsolidator + archiveFile 单测（MEM-02 / Wave 0）
 *
 * 覆盖 PLAN 01-02 Task 1 的 7 条 consolidator 断言 + 3 条 archiveFile 断言：
 *   1) merge 走 store.saveMemory（双写 INDEX.md + .index.json）
 *   2) 软删除：merge 后原文件在 `.archive/knowledge/` 下、原目录下不存在
 *   3) 阈值读 config（lowImportanceThreshold 命中/不命中）
 *   4) 过期：cleanupExpired 基于 indexed accessedAt 命中/不命中
 *   5) merge store 缺失抛错（D-09）
 *   6) D-04 双记：cleanup 后存在 observation + tags 含 consolidation
 *   7) .archive 不被重扫（getRecentMemories 不含归档条目）
 *   archive a) rename 落 .archive/<type>/   b) sourcePath 不存在抛错
 *   archive c) toSafeFilename 防 `../`
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryStore } from './index.js';
import { MemoryConsolidator } from './consolidate.js';
import { archiveFile } from './archive.js';
import { formatMemoryToMarkdown } from './types.js';
import { _resetMemoryIndex } from './memory-index.js';
import { useTempDataDir } from '../../test/helpers.js';

describe('MemoryConsolidator', () => {
  let dir: string;
  let store: MemoryStore;
  let consolidator: MemoryConsolidator;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'consolidate-test-'));
    // 预建四类记忆子目录，测试可直接 writeFileSync 造数据（store.saveMemory 也会自动建，但
    // 手写文件路径绕过 saveMemory 时需目录已存在）
    for (const sub of ['knowledge', 'observations', 'interactions', 'profile']) {
      mkdirSync(join(dir, sub), { recursive: true });
    }
    store = new MemoryStore({ basePath: dir });
    consolidator = new MemoryConsolidator(dir, store);
    _resetMemoryIndex();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    _resetMemoryIndex();
  });

  test('merge 走 store.saveMemory：合并记忆进 INDEX.md / .index.json', async () => {
    // 造两条同话题 knowledge 记忆（走 store 双写）
    await store.saveMemory({
      type: 'knowledge', timestamp: '2026-06-01T00:00:00.000Z',
      tags: ['llm'], summary: 'DeepSeek a', content: '内容a', importance: 0.5,
    });
    await store.saveMemory({
      type: 'knowledge', timestamp: '2026-06-02T00:00:00.000Z',
      tags: ['llm'], summary: 'DeepSeek b', content: '内容b', importance: 0.6,
    });

    // 用文件名直接造同话题（merge 按 filename 含 topic 匹配）
    // store.saveMemory 生成的 id 含时间戳，话题匹配不保证；这里直接手写两份带话题名的文件
    const knowledgeDir = join(dir, 'knowledge');
    writeFileSync(
      join(knowledgeDir, 'knowledge-llmtopic-aaa.md'),
      formatMemoryToMarkdown({
        id: 'knowledge-llmtopic-aaa', type: 'knowledge',
        timestamp: '2026-06-01T00:00:00.000Z', tags: ['llm'],
        summary: 'LLM 话题 a', content: '内容a', importance: 0.5,
      }),
      'utf-8',
    );
    writeFileSync(
      join(knowledgeDir, 'knowledge-llmtopic-bbb.md'),
      formatMemoryToMarkdown({
        id: 'knowledge-llmtopic-bbb', type: 'knowledge',
        timestamp: '2026-06-02T00:00:00.000Z', tags: ['llm'],
        summary: 'LLM 话题 b', content: '内容b', importance: 0.6,
      }),
      'utf-8',
    );

    await consolidator.mergeTopicMemories('llmtopic');

    // 断言：merged 记忆通过 store.saveMemory 写入（INDEX.md 含 topic-merged 条目）
    const index = await store.readIndex();
    expect(index.recentMemories.some((id) => id.includes('llmtopic-merged'))).toBe(true);
  });

  test('软删除：merge 后原文件在 .archive/knowledge/ 下，原目录不存在', async () => {
    const knowledgeDir = join(dir, 'knowledge');
    const fileA = 'knowledge-softdelete-aaa.md';
    const fileB = 'knowledge-softdelete-bbb.md';
    writeFileSync(join(knowledgeDir, fileA), formatMemoryToMarkdown({
      id: 'knowledge-softdelete-aaa', type: 'knowledge',
      timestamp: '2026-06-01T00:00:00.000Z', tags: ['x'],
      summary: '软删 a', content: 'a', importance: 0.5,
    }), 'utf-8');
    writeFileSync(join(knowledgeDir, fileB), formatMemoryToMarkdown({
      id: 'knowledge-softdelete-bbb', type: 'knowledge',
      timestamp: '2026-06-02T00:00:00.000Z', tags: ['x'],
      summary: '软删 b', content: 'b', importance: 0.5,
    }), 'utf-8');

    await consolidator.mergeTopicMemories('softdelete');

    // 原文件不再在 knowledge/ 目录
    expect(existsSync(join(knowledgeDir, fileA))).toBe(false);
    expect(existsSync(join(knowledgeDir, fileB))).toBe(false);
    // 归档目录存在这两个文件
    const archiveDir = join(dir, '.archive', 'knowledge');
    expect(existsSync(archiveDir)).toBe(true);
    const archived = readdirSync(archiveDir);
    expect(archived.length).toBeGreaterThanOrEqual(2);
  });

  test('阈值读 config：lowImportanceThreshold=0.2 命中低价值清理', async () => {
    // 造一条 importance=0.15 且 timestamp 8 天前的记忆
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const knowledgeDir = join(dir, 'knowledge');
    writeFileSync(
      join(knowledgeDir, 'knowledge-lowimp-old.md'),
      formatMemoryToMarkdown({
        id: 'knowledge-lowimp-old', type: 'knowledge',
        timestamp: old, tags: ['x'], summary: '低价值旧',
        content: 'x', importance: 0.15,
      }),
      'utf-8',
    );

    // config.consolidation.lowImportanceThreshold 默认 0.2；0.15 < 0.2 且 age>7 → 命中
    const merged = await consolidator.consolidateOldMemories();
    expect(merged).toBeGreaterThanOrEqual(1);
    // 被软删除到归档（basename 过 toSafeFilename 再补 .md）
    const archivedKnowledge = readdirSync(join(dir, '.archive', 'knowledge'));
    expect(archivedKnowledge.some((f) => f.startsWith('knowledge-lowimp-old'))).toBe(true);
  });

  test('阈值读 config：minImportance=0.1 时不清理 importance=0.15', async () => {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const knowledgeDir = join(dir, 'knowledge');
    writeFileSync(
      join(knowledgeDir, 'knowledge-lowimp-keep.md'),
      formatMemoryToMarkdown({
        id: 'knowledge-lowimp-keep', type: 'knowledge',
        timestamp: old, tags: ['x'], summary: '低价值但保留',
        content: 'x', importance: 0.15,
      }),
      'utf-8',
    );

    // 显式 minImportance=0.1（>0.15）→ 不清理
    const merged = await consolidator.consolidateOldMemories({ minImportance: 0.1 });
    expect(merged).toBe(0);
    expect(existsSync(join(knowledgeDir, 'knowledge-lowimp-keep.md'))).toBe(true);
  });

  test('过期：accessedAt 70 天前的记忆被 cleanupExpired 命中（expiryDays 默认 60）', async () => {
    const oldAccess = new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString();
    const observationDir = join(dir, 'observations');
    writeFileSync(
      join(observationDir, 'observation-old.md'),
      formatMemoryToMarkdown({
        id: 'observation-old', type: 'observation',
        timestamp: oldAccess, tags: [], summary: '过期观察',
        content: 'x', importance: 0.3, accessedAt: oldAccess,
      }),
      'utf-8',
    );

    const expired = await consolidator.cleanupExpired();
    expect(expired).toBeGreaterThanOrEqual(1);
    const archivedObs = readdirSync(join(dir, '.archive', 'observations'));
    expect(archivedObs.some((f) => f.startsWith('observation-old'))).toBe(true);
  });

  test('过期：accessedAt 30 天前的记忆不被 cleanupExpired 清理', async () => {
    const recentAccess = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const observationDir = join(dir, 'observations');
    writeFileSync(
      join(observationDir, 'observation-recent.md'),
      formatMemoryToMarkdown({
        id: 'observation-recent', type: 'observation',
        timestamp: recentAccess, tags: [], summary: '近期观察',
        content: 'x', importance: 0.3, accessedAt: recentAccess,
      }),
      'utf-8',
    );

    const expired = await consolidator.cleanupExpired();
    // 可能清理 0 条（该目录只有这一条近期记忆）
    expect(expired).toBe(0);
    expect(existsSync(join(observationDir, 'observation-recent.md'))).toBe(true);
  });

  test('merge store 缺失抛错（D-09，不兜底）', () => {
    const noStoreConsolidator = new MemoryConsolidator(dir, undefined);
    expect(() => noStoreConsolidator.mergeTopicMemories('anytopic')).toThrow(
      /MemoryStore/,
    );
  });

  test('D-04 双记：cleanup 后存在 observation + tags 含 consolidation', async () => {
    const old = new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString();
    const observationDir = join(dir, 'observations');
    writeFileSync(
      join(observationDir, 'observation-d4.md'),
      formatMemoryToMarkdown({
        id: 'observation-d4', type: 'observation',
        timestamp: old, tags: [], summary: '过期',
        content: 'x', importance: 0.3, accessedAt: old,
      }),
      'utf-8',
    );

    await consolidator.cleanupExpired();

    // 双记：store 中存在一条 type=observation + tags 含 consolidation 的记忆
    const recent = await store.getRecentMemories({ count: 50 });
    const consolidationRecord = recent.find(
      (m) => m.type === 'observation' && m.tags.includes('consolidation'),
    );
    expect(consolidationRecord).toBeDefined();
  });

  test('.archive 不被重扫：getRecentMemories 结果不含归档条目', async () => {
    const old = new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString();
    const observationDir = join(dir, 'observations');
    writeFileSync(
      join(observationDir, 'observation-skip.md'),
      formatMemoryToMarkdown({
        id: 'observation-skip', type: 'observation',
        timestamp: old, tags: [], summary: '归档',
        content: 'unique-archive-marker', importance: 0.3, accessedAt: old,
      }),
      'utf-8',
    );

    await consolidator.cleanupExpired();

    // 归档后 .archive/ 存在文件，但 getRecentMemories 不应返回归档内容
    const recent = await store.getRecentMemories({ count: 50 });
    const leak = recent.find((m) => m.content.includes('unique-archive-marker'));
    expect(leak).toBeUndefined();
  });
});

describe('archiveFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'archive-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('rename 源文件到 .archive/<type>/ 下', async () => {
    const knowledgeDir = join(dir, 'knowledge');
    mkdirSync(knowledgeDir, { recursive: true });
    const sourcePath = join(knowledgeDir, 'test-arch-xyz.md');
    writeFileSync(sourcePath, '# test', 'utf-8');

    await archiveFile(sourcePath, 'knowledge', dir);

    // basename 过 toSafeFilename（. 被净化为 -）再补 .md
    expect(existsSync(sourcePath)).toBe(false);
    const archiveDir = join(dir, '.archive', 'knowledge');
    const archived = readdirSync(archiveDir);
    expect(archived).toContain('test-arch-xyz-md.md');
  });

  test('sourcePath 不存在抛 Error（D-09，不静默跳过）', async () => {
    const ghost = join(dir, 'knowledge', 'nonexistent.md');
    await expect(archiveFile(ghost, 'knowledge', dir)).rejects.toThrow(/不存在|archiveFile/);
  });

  test('toSafeFilename 防 `../`：恶意文件名被净化', async () => {
    // 直接造一个含 `../` 的恶意文件名（模拟攻击者写入）
    const knowledgeDir = join(dir, 'knowledge');
    mkdirSync(knowledgeDir, { recursive: true });
    const evilName = 'knowledge-..-evil.md';
    const sourcePath = join(knowledgeDir, evilName);
    writeFileSync(sourcePath, '# evil', 'utf-8');

    await archiveFile(sourcePath, 'knowledge', dir);

    // 归档目录下的文件名被净化（不含 ..）
    const archived = readdirSync(join(dir, '.archive', 'knowledge'));
    expect(archived.some((f) => f.includes('..'))).toBe(false);
    // 确认无逃逸：.archive 之外不应有 evil 落地
    expect(existsSync(join(dir, 'evil.md'))).toBe(false);
  });
});

describe('loadBehaviorConfig 嵌套合并', () => {
  let tempEnv: { cleanup: () => void };

  beforeEach(() => {
    tempEnv = useTempDataDir();
  });

  afterEach(() => {
    tempEnv.cleanup();
  });

  // W2 数据安全：部分 consolidation 配置时其它字段仍取默认值（防 undefined 阈值致误归档）
  test('部分 consolidation 配置时其它字段仍取默认值（W2 数据安全）', async () => {
    // 构造只含 consolidation.expiryDays=10 的 agent-config.json（其余字段缺失）
    mkdirSync('data', { recursive: true });
    writeFileSync(
      'data/agent-config.json',
      JSON.stringify({
        _consolidationNote: 'test',
        consolidation: { expiryDays: 10 },
      }),
      'utf-8',
    );

    // 重新 import config.ts（会重新执行 loadBehaviorConfig）
    // 用动态 import 缓存破坏：加查询串让 ESM loader 重新加载
    const configMod = await import(`../../config.ts?t=${Date.now()}`);
    const consolidation = configMod.config.consolidation;

    // expiryDays 用用户值；其余三字段必须从默认取（不 undefined）
    expect(consolidation).toBeDefined();
    expect(consolidation.expiryDays).toBe(10);
    expect(consolidation.lowImportanceThreshold).toBe(0.2);
    expect(consolidation.mergeMaxAgeDays).toBe(7);
    expect(consolidation.urlCleanupDays).toBe(30);
  });
});
