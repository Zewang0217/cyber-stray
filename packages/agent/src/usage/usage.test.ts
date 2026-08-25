/**
 * 用量记录测试（#129）—— recordUsage JSONL 落盘 / no-throw / 按天轮转
 *
 * 契约：租户目录 usage/usage-YYYY-MM-DD.jsonl（本地日期）；行含
 * timestamp/tenantId/kind/model/tokens|images；写入失败静默不抛。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { recordUsage, localDateKey, withImageUsageTracking, modelIdOf } from './usage.js';
import type { ImageGenerator } from '../meme/types.js';

describe('recordUsage', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-usage-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('写租户 usage 目录，按本地日期轮转，行结构完整', async () => {
    await recordUsage(dir, { kind: 'llm', model: 'deepseek-chat', tokens: 123 });
    await recordUsage(dir, { kind: 'image', model: 'doubao-seedream-5-0-260128', images: 1 });

    const file = join(dir, 'usage', `usage-${localDateKey()}.jsonl`);
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(first.kind).toBe('llm');
    expect(first.model).toBe('deepseek-chat');
    expect(first.tokens).toBe(123);
    expect(typeof first.timestamp).toBe('string');
    expect(typeof first.tenantId).toBe('string');

    const second = JSON.parse(lines[1]!) as Record<string, unknown>;
    expect(second.kind).toBe('image');
    expect(second.images).toBe(1);
  });

  it('同一天追加同一文件（不覆盖）', async () => {
    await recordUsage(dir, { kind: 'llm', model: 'm', tokens: 1 });
    await recordUsage(dir, { kind: 'llm', model: 'm', tokens: 2 });
    const file = join(dir, 'usage', `usage-${localDateKey()}.jsonl`);
    expect(readFileSync(file, 'utf-8').trim().split('\n')).toHaveLength(2);
  });

  it('no-throw：坏 dataDir 不抛错', async () => {
    await expect(recordUsage('/nonexistent-root', { kind: 'llm', model: 'm' })).resolves.toBeUndefined();
  });
});

describe('withImageUsageTracking', () => {
  it('generate 成功后记一条 image 用量', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-usage-wrap-'));
    try {
      const inner: ImageGenerator = {
        async generate(req) {
          return { imagePath: req.outPath };
        },
      };
      const tracked = withImageUsageTracking(inner, dir, 'seedream-m');
      await tracked.generate({ prompt: 'x', outPath: join(dir, 'g.png') });
      const file = join(dir, 'usage', `usage-${localDateKey()}.jsonl`);
      const line = JSON.parse(readFileSync(file, 'utf-8').trim()) as Record<string, unknown>;
      expect(line.kind).toBe('image');
      expect(line.model).toBe('seedream-m');
      expect(line.images).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('generate 失败不记录（只记成功出图）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-usage-wrap-'));
    try {
      const inner: ImageGenerator = {
        async generate() {
          throw new Error('boom');
        },
      };
      const tracked = withImageUsageTracking(inner, dir, 'm');
      await expect(tracked.generate({ prompt: 'x', outPath: 'x' })).rejects.toThrow('boom');
      expect(existsSync(join(dir, 'usage'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('modelIdOf', () => {
  it('从 AI SDK 模型对象取 modelId；缺省 unknown', () => {
    expect(modelIdOf({ modelId: 'deepseek-chat' })).toBe('deepseek-chat');
    expect(modelIdOf({})).toBe('unknown');
    expect(modelIdOf(null)).toBe('unknown');
  });
});

describe('localDateKey', () => {
  it('本地日期 YYYY-MM-DD（非 UTC——与 speaks 文件同源）', () => {
    expect(localDateKey(new Date(2026, 7, 15, 23, 30))).toBe('2026-08-15');
    // UTC+8 边界：本地 8 月 16 日 00:30 = UTC 8 月 15 日 16:30 → 文件按本地 16 日
    expect(localDateKey(new Date(2026, 7, 16, 0, 30))).toBe('2026-08-16');
  });
});
