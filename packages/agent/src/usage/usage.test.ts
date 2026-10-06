/**
 * 用量记录测试—— JSONL 落盘 / 记账失败显式停止 / 按天轮转
 *
 * 契约：租户目录 usage/usage-YYYY-MM-DD.jsonl（本地日期）；行含
 * timestamp/tenantId/kind/model/tokens|images；写入或计量字段无效即抛错。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { recordUsage, localDateKey, withImageUsageTracking, withVisionUsageTracking, modelIdOf, assertUsageReady } from './usage.js';
import type { ImageGenerator } from '../meme/types.js';
import type { ImageGenRequest } from '../meme/ark.js';

describe('recordUsage', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-usage-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it.each(['deepseek-v4-flash', 'deepseek-flash'])('%s 通过付费前预检并按实际模型 ID 落账', async (model) => {
    expect(() => assertUsageReady(dir, model, 'llm')).not.toThrow();
    await recordUsage(dir, { kind: 'llm', model, inputTokens: 100, outputTokens: 50 });
    const file = join(dir, 'usage', `usage-${localDateKey()}.jsonl`);
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toMatchObject({ model, inputTokens: 100, outputTokens: 50 });
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

  it('账本不可写时显式报错，不把失败当作零用量', async () => {
    writeFileSync(join(dir, 'usage'), 'blocked');
    await expect(recordUsage(dir, { kind: 'llm', model: 'm', tokens: 1 })).rejects.toThrow('用量记账失败');
  });

  it('供应商缺少用量时明确失败，不写没有计量的账单行', async () => {
    await expect(recordUsage(dir, { kind: 'llm', model: 'm' })).rejects.toThrow('用量记账失败');
  });

  it('未知生图或质检价格在调用供应商前拒绝', async () => {
    const generate = vi.fn(async (req: { outPath: string }) => ({ imagePath: req.outPath }));
    const inspect = vi.fn(async () => ({ ok: true }));
    const image = withImageUsageTracking({ generate }, dir, 'unpriced-image');
    const vision = withVisionUsageTracking(inspect, dir, 'unpriced-vision');
    await expect(image.generate({ prompt: 'x', outPath: 'x' })).rejects.toThrow('未知模型单价');
    await expect(vision({})).rejects.toThrow('未知模型单价');
    expect(generate).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
  });

  it('记账失败即便被上层捕获，后续生图和质检也不会再次调用供应商', async () => {
    const generate = vi.fn(async (req: ImageGenRequest) => {
      await req.onUsage?.();
      return { imagePath: req.outPath };
    });
    const inspect = vi.fn(async () => ({ ok: true }));
    const image = withImageUsageTracking({ generate }, dir, 'doubao-seedream-5-0-260128');
    const vision = withVisionUsageTracking(inspect, dir, 'glm-4v-flash');
    writeFileSync(join(dir, 'usage'), 'blocked');
    await expect(image.generate({ prompt: 'x', outPath: 'x' })).rejects.toThrow('用量记账失败');
    await expect(image.generate({ prompt: 'x', outPath: 'x' })).rejects.toThrow('用量记账失败');
    await expect(vision({})).rejects.toThrow('用量记账失败');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(inspect).not.toHaveBeenCalled();
  });
});

describe('withImageUsageTracking', () => {
  it('generate 成功后记一条 image 用量', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-usage-wrap-'));
    try {
      const inner: ImageGenerator = {
        async generate(req) {
          await req.onUsage?.();
          return { imagePath: req.outPath };
        },
      };
      const tracked = withImageUsageTracking(inner, dir, 'doubao-seedream-5-0-260128');
      await tracked.generate({ prompt: 'x', outPath: join(dir, 'g.png') });
      const file = join(dir, 'usage', `usage-${localDateKey()}.jsonl`);
      const line = JSON.parse(readFileSync(file, 'utf-8').trim()) as Record<string, unknown>;
      expect(line.kind).toBe('image');
      expect(line.model).toBe('doubao-seedream-5-0-260128');
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
      const tracked = withImageUsageTracking(inner, dir, 'doubao-seedream-5-0-260128');
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
