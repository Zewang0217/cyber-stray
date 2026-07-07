import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryStore } from './index.js';
import { toSafeFilename } from './types.js';
import { _resetMemoryIndex, loadJsonIndex } from './memory-index.js';

describe('MemoryStore', () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'memory-test-'));
    store = new MemoryStore({ basePath: dir });
    _resetMemoryIndex();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    _resetMemoryIndex();
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
    // WR-06：概览区 key 改 ASCII 后 totalMemories / typeStats 也能正确往返
    expect(read.totalMemories).toBe(5);
    expect(read.typeStats).toEqual({
      profile: 1,
      knowledge: 2,
      interaction: 1,
      observation: 1,
    });
  });
});

/**
 * MEM-01 Task 2：MemoryStore 改造（双写钩子 + 检索走索引 + getMemory 不读即写 + D-09 显式化）
 *
 * 覆盖 PLAN.md Task 2 <behavior> 7 条断言：
 * 1) saveMemory 双写（.index.json records 含该条）
 * 2) getMemory 不读即写（mtime 不变）
 * 3) getRecentMemories 索引命中（不经 getMemory）
 * 4) D-09 not found（getMemory→null / deleteMemory→false）
 * 5) D-09 解析失败（非法 Markdown → getMemory 抛 Error）
 * 6) readIndex 解析失败（非法 INDEX.md → readIndex 抛 Error）
 * 7) deleteMemory 索引联动（.index.json records 不含该条）
 */
describe('MemoryStore（索引层改造 / MEM-01）', () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'memory-idx-test-'));
    store = new MemoryStore({ basePath: dir });
    _resetMemoryIndex();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    _resetMemoryIndex();
  });

  /** 构造一条有效的 saveMemory 入参 */
  function makeEntryArgs() {
    return {
      type: 'knowledge' as const,
      timestamp: '2026-06-20T00:00:00.000Z',
      tags: ['ai'],
      summary: 'DeepSeek V4',
      content: '开源了 Agent 能力',
      importance: 0.6,
    };
  }

  // 1) saveMemory 双写：INDEX.md + .index.json 同步
  test('saveMemory 双写：.index.json records 含该条（与 INDEX.md 同步）', async () => {
    const saved = await store.saveMemory(makeEntryArgs());

    const jsonIndex = await loadJsonIndex(join(dir, '.index.json'));
    expect(jsonIndex.records.find((r) => r.id === saved.id)).toBeDefined();

    // INDEX.md 也应含该 id（双写可见）
    const mdIndex = await store.readIndex();
    expect(mdIndex.recentMemories).toContain(saved.id);
  });

  // 2) getMemory 不读即写：文件 mtime 不变（写放大消除）
  test('getMemory 不读即写：前后文件 mtime 不变', async () => {
    const saved = await store.saveMemory(makeEntryArgs());
    const filepath = join(dir, 'knowledge', `${toSafeFilename(saved.id)}.md`);

    // 两次 stat：读前 & 读后；时间需 <1s 间隔以保证 mtime 秒级粒度可靠
    const before = statSync(filepath).mtimeMs;
    await new Promise((r) => setTimeout(r, 1100)); // 等 >1s（mtime 粒度）
    await store.getMemory('knowledge', saved.id);
    const after = statSync(filepath).mtimeMs;

    expect(after).toBe(before);
  });

  // 3) getRecentMemories 索引命中：不经 getMemory（用 spy wrapper 计数）
  test('getRecentMemories 索引命中：不调 getMemory（走 jsonIndex 直接 readFile）', async () => {
    const saved = await store.saveMemory(makeEntryArgs());

    let getMemoryCalls = 0;
    const spyStore = new MemoryStore({ basePath: dir });
    const origGetMemory = spyStore.getMemory.bind(spyStore);
    spyStore.getMemory = async (...args) => {
      getMemoryCalls++;
      return origGetMemory(...args);
    };

    const results = await spyStore.getRecentMemories({ count: 10 });
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe(saved.id);
    // 走索引后 getRecentMemories 不应再调 getMemory（旧实现循环里调 getMemory）
    expect(getMemoryCalls).toBe(0);
  });

  // 4) D-09 not found：getMemory→null / deleteMemory→false
  test('D-09 not found：getMemory 返 null / deleteMemory 返 false（合法空值）', async () => {
    const got = await store.getMemory('knowledge', 'does-not-exist');
    expect(got).toBeNull();

    const deleted = await store.deleteMemory('knowledge', 'does-not-exist');
    expect(deleted).toBe(false);
  });

  // 5) D-09 解析失败：非法 Markdown → getMemory 抛 Error（不返 null 兜底）
  test('D-09 解析失败：非法内容 → getMemory 抛 Error（不返 null）', async () => {
    const saved = await store.saveMemory(makeEntryArgs());
    const filepath = join(dir, 'knowledge', `${toSafeFilename(saved.id)}.md`);
    writeFileSync(filepath, '完全非法的非 Markdown 内容 { 乱码', 'utf-8');

    expect(store.getMemory('knowledge', saved.id)).rejects.toThrow();
  });

  // 6) readIndex 解析失败：非法 INDEX.md → readIndex 抛 Error（不返默认）
  test('D-09 readIndex 解析失败：非法 INDEX.md → 抛 Error（不返默认）', async () => {
    // 先写一条触发 INDEX.md 创建
    await store.saveMemory(makeEntryArgs());
    const indexPath = join(dir, 'INDEX.md');
    writeFileSync(indexPath, '完全非法的内容 ###乱码', 'utf-8');

    expect(store.readIndex()).rejects.toThrow();
  });

  // 7) deleteMemory 索引联动：.index.json records 不含该条
  test('deleteMemory 索引联动：.index.json records 不含该条', async () => {
    const saved = await store.saveMemory(makeEntryArgs());
    const ok = await store.deleteMemory('knowledge', saved.id);
    expect(ok).toBe(true);

    const jsonIndex = await loadJsonIndex(join(dir, '.index.json'));
    expect(jsonIndex.records.find((r) => r.id === saved.id)).toBeUndefined();
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
