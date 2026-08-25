/**
 * image_meme 工具测试（#96）
 *
 * 工具契约：注入 fake 管线依赖 + fake 文案 runner，验证：
 * - 成功路径：recorded → 返回 ok:true + imageUrl
 * - 质检不过：rejected → ok:false + 原因
 * - 配额超限：skipped → ok:false + 配额原因
 * - IP 模式无概念图 → 显式拒绝（提示用 abstract）
 * - 生图失败：failed → ok:false
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Tool } from 'ai';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { setImageMemeToolDeps, imageMemeToolDef } from './image-meme.js';
import { makeState } from '../../test/helpers.js';
import type { ToolContext } from './context.js';
import type { MemePipelineDeps } from '../../meme/types.js';
import type { MemeCopyGenerator } from '../../meme/pipeline.js';

const COPY_GEN: MemeCopyGenerator = async () => ({
  text: '量子纠缠人生纠缠',
  emotion: '自嘲',
  topic: '量子计算',
});

/** 执行 AI SDK tool（execute 在构造时注入；用 unknown 中转避免类型冲突） */
async function runTool(
  tool: Tool,
  input: Record<string, unknown>,
): Promise<unknown> {
  const exec = (tool as unknown as { execute: (i: unknown) => Promise<unknown> }).execute;
  return exec(input);
}

function makeCtx(): ToolContext {
  return {
    state: makeState(),
    traceId: 'trace-1',
    stepCount: 0,
    wanderHistory: [],
    visitedUrls: [],
    spokeTimes: 0,
    pendingFeedbackCount: 0,
    endReason: 'max_steps',
    startTime: Date.now(),
    searchQueries: [],
  };
}

function makeDeps(overrides: Partial<MemePipelineDeps> = {}): MemePipelineDeps {
  return {
    dataDir: '',
    imageGen: {
      async generate(req) {
        writeFileSync(req.outPath, Buffer.from('IMG'));
        return { imagePath: req.outPath };
      },
    },
    overlay: {
      async apply(_imagePath, _text, outPath) {
        writeFileSync(outPath, Buffer.from('FINAL'));
        return outPath;
      },
    },
    qc: { async inspect() { return { pass: true, issues: [] }; } },
    dailyLimit: 3,
    now: () => Date.UTC(2026, 7, 20),
    ...overrides,
  };
}

describe('image_meme 工具', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'meme-tool-'));
    mkdirSync(join(dir, 'meme-assets'), { recursive: true });
    setImageMemeToolDeps({
      buildDeps: () => makeDeps({ dataDir: dir }),
      buildCopy: () => COPY_GEN,
    });
  });

  afterEach(() => {
    setImageMemeToolDeps({});
    rmSync(dir, { recursive: true, force: true });
  });

  it('abstract 成功 → ok:true + imageUrl', async () => {
    const tool = imageMemeToolDef.createTool(makeCtx());
    // AI SDK tool：直接调用 execute（input 已 zod 校验）
    const result = (await runTool(tool, { topic: '量子计算', mode: 'abstract' })) as { ok: boolean; id?: string; imageUrl?: string };
    expect(result.ok).toBe(true);
    expect(result.id).toBeTruthy();
    expect(result.imageUrl).toMatch(/\/api\/meme\/.*\/image\.png/);
  });

  it('质检不过 → ok:false + 原因（不进图鉴）', async () => {
    setImageMemeToolDeps({
      buildDeps: () =>
        makeDeps({
          dataDir: dir,
          qc: { async inspect() { return { pass: false, issues: ['梗文字被切一半'] }; } },
        }),
      buildCopy: () => COPY_GEN,
    });
    const tool = imageMemeToolDef.createTool(makeCtx());
    const result = (await runTool(tool, { topic: 't', mode: 'abstract' })) as { ok: boolean; reason?: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('质检');
  });

  it('配额超限 → ok:false + 配额原因', async () => {
    const { memeManifestPath } = await import('../../meme/storage.js');
    writeFileSync(
      memeManifestPath(dir),
      JSON.stringify([
        { id: 'a', date: '2026-08-20', qcPass: true },
        { id: 'b', date: '2026-08-20', qcPass: true },
        { id: 'c', date: '2026-08-20', qcPass: true },
      ]),
    );
    setImageMemeToolDeps({
      buildDeps: () => makeDeps({ dataDir: dir, dailyLimit: 3 }),
      buildCopy: () => COPY_GEN,
    });
    const tool = imageMemeToolDef.createTool(makeCtx());
    const result = (await runTool(tool, { topic: 't', mode: 'abstract' })) as { ok: boolean; reason?: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/配额/);
  });

  it('IP 模式无概念图 → 显式拒绝（提示用 abstract）', async () => {
    const tool = imageMemeToolDef.createTool(makeCtx());
    const result = (await runTool(tool, { topic: 't', mode: 'ip' })) as { ok: boolean; reason?: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('abstract');
  });

  it('生图失败 → ok:false', async () => {
    setImageMemeToolDeps({
      buildDeps: () =>
        makeDeps({
          dataDir: dir,
          imageGen: {
            async generate() {
              throw new Error('火山 500');
            },
          },
        }),
      buildCopy: () => COPY_GEN,
    });
    const tool = imageMemeToolDef.createTool(makeCtx());
    const result = (await runTool(tool, { topic: 't', mode: 'abstract' })) as { ok: boolean; reason?: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('生图失败');
  });
});
