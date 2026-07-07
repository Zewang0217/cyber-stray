import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile } from 'fs/promises';
import {
  MemoryIndex,
  loadJsonIndex,
  saveJsonIndex,
  getMemoryIndex,
  _resetMemoryIndex,
} from './memory-index.js';
import {
  formatMemoryToMarkdown,
  MEMORY_TYPE_PATHS,
  type MemoryEntry,
} from './types.js';

/**
 * MEM-01 Wave 0 测试：MemoryIndex（JSON sidecar 索引读写）
 *
 * 覆盖 PLAN.md <behavior> 7 条断言：
 * 1) 双写一致性（saveJsonIndex → loadJsonIndex → records 含该条）
 * 2) 原子写（写后 .tmp 不残留）
 * 3) 重建（rebuildIndexFromMarkdown 从 4 个 MEMORY_TYPE_PATHS 子目录重建）
 * 4) 索引命中（queryRecent 不读 Markdown 文件）
 * 5) accessedAt 迁移（rebuild 读取 frontmatter accessedAt 写入索引）
 * 6) schema 漂移（删 version → load 触发重建路径）
 * 7) D-09 显式化（非法 JSON → loadJsonIndex 抛 Error，不返默认）
 */

describe('MemoryIndex', () => {
  let basePath: string;
  let jsonPath: string;

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), 'memidx-test-'));
    jsonPath = join(basePath, '.index.json');
    _resetMemoryIndex();
  });

  afterEach(() => {
    rmSync(basePath, { recursive: true, force: true });
    _resetMemoryIndex();
  });

  /** 构造一条有效 MemoryEntry（含可选 accessedAt） */
  function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
    return {
      id: 'knowledge-1718000000000-abcdef1234567890',
      type: 'knowledge',
      timestamp: '2026-06-20T00:00:00.000Z',
      tags: ['ai', 'llm'],
      summary: 'DeepSeek V4 开源',
      content: 'DeepSeek V4 开源，Agent 能力第一',
      importance: 0.6,
      accessedAt: '2026-06-20T01:00:00.000Z',
      ...overrides,
    };
  }

  // ============================================
  // 1) 双写一致性
  // ============================================
  test('双写一致性：saveJsonIndex 后 loadJsonIndex records 含该条', async () => {
    const entry = makeEntry();
    const index = new MemoryIndex(jsonPath, basePath);
    await index.upsert(entry);
    await index.persist();

    // 重新 load 验证落盘
    const reloaded = await loadJsonIndex(jsonPath);
    expect(reloaded.version).toBe(1);
    const found = reloaded.records.find((r) => r.id === entry.id);
    expect(found).toBeDefined();
    expect(found!.type).toBe('knowledge');
    expect(found!.summary).toBe('DeepSeek V4 开源');
    expect(found!.filepath).toBe(`${MEMORY_TYPE_PATHS.knowledge}/${entry.id}.md`);
  });

  // ============================================
  // 2) 原子写：temp-file + rename，无 .tmp 残留
  // ============================================
  test('原子写：写后 .index.json 存在、.index.json.tmp 不残留', async () => {
    const index = new MemoryIndex(jsonPath, basePath);
    await index.upsert(makeEntry());
    await index.persist();

    expect(existsSync(jsonPath)).toBe(true);
    expect(existsSync(`${jsonPath}.tmp`)).toBe(false);

    // 落盘内容是合法 JSON 且含 records
    const content = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    expect(content.records).toBeInstanceOf(Array);
    expect(content.records.length).toBe(1);
  });

  // ============================================
  // 2b) 并发 persist 安全（MEM-01 并发修复回归测试）
  // ============================================
  test('并发 persist 安全：多个 persist 并行不崩、不丢、无 tmp 残留', async () => {
    const index = new MemoryIndex(jsonPath, basePath);
    // 模拟 ReAct 一步内并行多个写工具：并发 upsert + persist
    const N = 8;
    const entries = Array.from({ length: N }, (_, i) =>
      makeEntry({ id: `knowledge-concurrent-${i}`, summary: `并发条目${i}` }),
    );
    // 修复前（固定 .tmp 名）：并发 rename ENOENT → persist 抛错 → Promise.all reject
    // 修复后（唯一 tmp + 串行化）：全部成功落盘
    await Promise.all(
      entries.map(async (e) => {
        await index.upsert(e);
        await index.persist();
      }),
    );

    const reloaded = await loadJsonIndex(jsonPath);
    expect(reloaded.records.length).toBe(N);
    for (const e of entries) {
      expect(reloaded.records.find((r) => r.id === e.id)).toBeDefined();
    }
    // 无残留 tmp 文件（所有唯一 tmp 都被 rename 消化）
    const { readdir: readdirAsync } = await import('fs/promises');
    const dirFiles = await readdirAsync(basePath);
    expect(dirFiles.filter((f) => f.includes('.index.json.tmp'))).toEqual([]);
  });

  // ============================================
  // 3) 重建：从 4 个 MEMORY_TYPE_PATHS 子目录 Markdown 重建
  // ============================================
  test('重建：rebuild 后 records 含 4 个 MEMORY_TYPE_PATHS 子目录的 Markdown 条目', async () => {
    // 在 4 个子目录各造一个 Markdown 文件
    const types = Object.keys(MEMORY_TYPE_PATHS) as Array<keyof typeof MEMORY_TYPE_PATHS>;
    for (const t of types) {
      const dir = join(basePath, MEMORY_TYPE_PATHS[t]);
      mkdirSync(dir, { recursive: true });
      const entry = makeEntry({
        id: `${t}-rebuild-test-id`,
        type: t,
        summary: `${t} 条目`,
      });
      const filepath = join(dir, `${entry.id}.md`);
      writeFileSync(filepath, formatMemoryToMarkdown(entry), 'utf-8');
    }

    const index = new MemoryIndex(jsonPath, basePath);
    await index.rebuild();

    const reloaded = await loadJsonIndex(jsonPath);
    expect(reloaded.records.length).toBe(types.length);
    for (const t of types) {
      const found = reloaded.records.find((r) => r.id === `${t}-rebuild-test-id`);
      expect(found).toBeDefined();
      expect(found!.type).toBe(t);
    }
  });

  test('重建只扫 MEMORY_TYPE_PATHS：.archive/ 下的 Markdown 不被扫入', async () => {
    const archiveDir = join(basePath, '.archive', MEMORY_TYPE_PATHS.knowledge);
    mkdirSync(archiveDir, { recursive: true });
    const ghostEntry = makeEntry({ id: 'knowledge-ghost-archived' });
    writeFileSync(
      join(archiveDir, `${ghostEntry.id}.md`),
      formatMemoryToMarkdown(ghostEntry),
      'utf-8',
    );

    const index = new MemoryIndex(jsonPath, basePath);
    await index.rebuild();

    const reloaded = await loadJsonIndex(jsonPath);
    expect(reloaded.records.find((r) => r.id === ghostEntry.id)).toBeUndefined();
  });

  // ============================================
  // 4) 索引命中：queryRecent 不读 Markdown 文件
  // ============================================
  test('索引命中：queryRecent 不读 Markdown（Markdown 不存在仍正常返回）', async () => {
    const index = new MemoryIndex(jsonPath, basePath);
    const entry = makeEntry();
    await index.upsert(entry);
    await index.persist();

    // 关键断言：basePath 下根本没有 Markdown 文件（只持久化了 .index.json）
    // 若 queryRecent 试图读 Markdown，会因为文件不存在而抛错或返回空。
    // 它能正常返回 records，证明走的是 JSON 索引、不读 Markdown。
    const dir = join(basePath, MEMORY_TYPE_PATHS.knowledge);
    expect(existsSync(dir)).toBe(false);

    const records = await index.queryRecent({ count: 10 });
    expect(records.length).toBe(1);
    expect(records[0]!.id).toBe(entry.id);
    // 返回的是索引记录（仅索引字段），不是 MemoryEntry
    expect(records[0]).not.toHaveProperty('content');
  });

  // ============================================
  // 5) accessedAt 迁移：rebuild 读 frontmatter accessedAt 写入索引
  // ============================================
  test('accessedAt 迁移：rebuild 将 frontmatter accessedAt 写入索引字段', async () => {
    const dir = join(basePath, MEMORY_TYPE_PATHS.knowledge);
    mkdirSync(dir, { recursive: true });
    const entry = makeEntry({
      id: 'knowledge-accessedat-migrate',
      accessedAt: '2026-06-19T12:34:56.000Z',
    });
    writeFileSync(
      join(dir, `${entry.id}.md`),
      formatMemoryToMarkdown(entry),
      'utf-8',
    );

    const index = new MemoryIndex(jsonPath, basePath);
    await index.rebuild();
    await index.persist();

    const reloaded = await loadJsonIndex(jsonPath);
    const found = reloaded.records.find((r) => r.id === entry.id);
    expect(found).toBeDefined();
    expect(found!.accessedAt).toBe('2026-06-19T12:34:56.000Z');
  });

  // ============================================
  // 6) schema 漂移：version 缺失 → loadJsonIndex 抛错（D-09）
  // ============================================
  test('schema 漂移：手改 .index.json 删 version 字段 → loadJsonIndex 抛 Error', async () => {
    await writeFile(
      jsonPath,
      JSON.stringify({ lastUpdated: '2026-06-20T00:00:00.000Z', records: [] }),
      'utf-8',
    );

    expect(loadJsonIndex(jsonPath)).rejects.toThrow();
  });

  // ============================================
  // 7) D-09 显式化：非法 JSON → loadJsonIndex 抛 Error（不返默认）
  // ============================================
  test('D-09 解析失败：手改 .index.json 为非法 JSON → loadJsonIndex 抛 Error（不返默认）', async () => {
    await writeFile(jsonPath, '{ not valid json !!!', 'utf-8');

    expect(loadJsonIndex(jsonPath)).rejects.toThrow();
  });

  // ============================================
  // 补充：existsSync false → loadJsonIndex 返默认空索引（not found 合法）
  // ============================================
  test('not found 合法空值：文件不存在时 loadJsonIndex 返默认空索引', async () => {
    const loaded = await loadJsonIndex(join(basePath, 'does-not-exist.json'));
    expect(loaded.version).toBe(1);
    expect(loaded.records).toEqual([]);
  });

  // ============================================
  // 补充：upsert 存在则更新 / 不存在则追加；remove 删除；touchAccessedAt/getAccessedAt
  // ============================================
  test('upsert：存在则更新、不存在则追加', async () => {
    const index = new MemoryIndex(jsonPath, basePath);
    const entry = makeEntry();
    await index.upsert(entry);
    expect((await index.queryRecent({ count: 10 })).length).toBe(1);

    // 更新（importance 变化）
    await index.upsert({ ...entry, importance: 0.95 });
    const records = await index.queryRecent({ count: 10 });
    expect(records.length).toBe(1);
    expect(records[0]!.importance).toBe(0.95);
  });

  test('remove：按 id 删除条目；不存在的 id 不抛错', async () => {
    const index = new MemoryIndex(jsonPath, basePath);
    const entry = makeEntry();
    await index.upsert(entry);
    await index.remove(entry.type, 'nonexistent-id'); // 不抛错
    expect((await index.queryRecent({ count: 10 })).length).toBe(1);

    await index.remove(entry.type, entry.id);
    expect((await index.queryRecent({ count: 10 })).length).toBe(0);
  });

  test('touchAccessedAt/getAccessedAt：更新并读取 accessedAt', async () => {
    const index = new MemoryIndex(jsonPath, basePath);
    const entry = makeEntry({ accessedAt: '2026-01-01T00:00:00.000Z' });
    await index.upsert(entry);

    expect(await index.getAccessedAt(entry.type, entry.id)).toBe('2026-01-01T00:00:00.000Z');

    await index.touchAccessedAt(entry.type, entry.id);
    const now = await index.getAccessedAt(entry.type, entry.id);
    expect(now).not.toBe('2026-01-01T00:00:00.000Z');
    expect(() => new Date(now!).toISOString()).not.toThrow();
  });

  test('queryRecent：支持 type/since 过滤 + count 裁剪 + 时间降序', async () => {
    const index = new MemoryIndex(jsonPath, basePath);
    await index.upsert(makeEntry({ id: 'k-1', timestamp: '2026-06-01T00:00:00.000Z', type: 'knowledge' }));
    await index.upsert(makeEntry({ id: 'k-2', timestamp: '2026-06-20T00:00:00.000Z', type: 'knowledge' }));
    await index.upsert(makeEntry({ id: 'p-1', timestamp: '2026-06-10T00:00:00.000Z', type: 'profile' }));

    // 全部降序
    const all = await index.queryRecent({ count: 10 });
    expect(all.map((r) => r.id)).toEqual(['k-2', 'p-1', 'k-1']);

    // type 过滤
    const knowledgeOnly = await index.queryRecent({ count: 10, type: 'knowledge' });
    expect(knowledgeOnly.map((r) => r.id)).toEqual(['k-2', 'k-1']);

    // since 过滤
    const since = await index.queryRecent({ count: 10, since: '2026-06-05T00:00:00.000Z' });
    expect(since.map((r) => r.id)).toEqual(['k-2', 'p-1']);

    // count 裁剪
    const limited = await index.queryRecent({ count: 1 });
    expect(limited.map((r) => r.id)).toEqual(['k-2']);
  });

  test('getMemoryIndex：模块级单例（同一 basePath 复用）', async () => {
    const a = getMemoryIndex(basePath);
    const b = getMemoryIndex(basePath);
    expect(a).toBe(b);
  });
});

/**
 * saveJsonIndex/loadJsonIndex 模块级函数的独立测试（不经过 MemoryIndex 类）
 */
describe('loadJsonIndex / saveJsonIndex', () => {
  let basePath: string;

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), 'memidx-fn-test-'));
    _resetMemoryIndex();
  });

  afterEach(() => {
    rmSync(basePath, { recursive: true, force: true });
    _resetMemoryIndex();
  });

  test('saveJsonIndex → loadJsonIndex 往返一致', async () => {
    const path = join(basePath, '.index.json');
    const data = {
      version: 1 as const,
      lastUpdated: '2026-06-20T00:00:00.000Z',
      records: [
        {
          id: 'r1',
          type: 'knowledge' as const,
          timestamp: '2026-06-20T00:00:00.000Z',
          accessedAt: '2026-06-20T00:00:00.000Z',
          importance: 0.5,
          tags: ['x'],
          summary: 's',
          filepath: 'knowledge/r1.md',
        },
      ],
    };
    await saveJsonIndex(path, data);
    const loaded = await loadJsonIndex(path);
    expect(loaded.records.length).toBe(1);
    expect(loaded.records[0]!.id).toBe('r1');
  });
});
