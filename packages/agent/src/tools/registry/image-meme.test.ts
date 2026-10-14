/**
 * image_meme 工具测试（#96 / #423）
 *
 * 工具契约：注入 fake 管线依赖 + fake 文案 runner，验证：
 * - 心情概率门：未命中软跳过（不碰管线）；心情档位决定概率
 * - 成功路径：recorded → 返回 ok:true + imageUrl
 * - 质检不过：rejected → ok:false + 原因
 * - 配额超限：skipped → ok:false + 配额原因
 * - 无租户角色 manifest → 显式拒绝
 * - 生图失败：failed → ok:false
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Tool } from 'ai';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, readFileSync } from 'fs';
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
  scene: '橘猫追着两只发光粒子转圈，尾巴打成结',
  topic: '量子计算',
});

/** 执行 AI SDK tool（execute 在构造时注入；用 unknown 中转避免类型冲突） */
async function runTool(
  tool: Tool,
  input: Record<string, unknown>,
): Promise<unknown> {
  const exec = (tool as unknown as { execute: (i: unknown, opts: { toolCallId: string; messages: [] }) => Promise<unknown> }).execute;
  return exec(input, { toolCallId: 'test-call', messages: [] });
}

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
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
    ...overrides,
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
    process.env.DATA_DIR = dir;
    mkdirSync(join(dir, 'meme-assets'), { recursive: true });
    mkdirSync(join(dir, 'pet-assets'), { recursive: true });
    writeFileSync(join(dir, 'pet-assets', 'manifest.json'), JSON.stringify({
      version: 2, spec: { specText: '蓝色小狗，白耳朵' },
    }));
    writeFileSync(join(dir, 'pet-assets', 'adopt-reference.jpg'), Buffer.from('REFERENCE'));
    // rng 恒 0 = 概率门必过（0 >= p 为假），管线路径测试不受随机影响
    setImageMemeToolDeps({
      buildDeps: () => makeDeps({ dataDir: dir }),
      buildCopy: () => COPY_GEN,
      rng: () => 0,
    });
  });

  afterEach(() => {
    setImageMemeToolDeps({});
    delete process.env.DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('#423 心情概率门未命中 → 软跳过，不触管线不耗配额', async () => {
    let pipelineTouched = false;
    setImageMemeToolDeps({
      buildDeps: () => {
        pipelineTouched = true;
        return makeDeps({ dataDir: dir });
      },
      buildCopy: () => COPY_GEN,
      rng: () => 0.99, // curious p=0.3，0.99 必未命中
    });
    const ctx = makeCtx();
    const tool = imageMemeToolDef.createTool(ctx);
    const result = (await runTool(tool, { topic: '量子计算' })) as { ok: boolean; reason?: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/心情/);
    expect(pipelineTouched).toBe(false);
    // 软跳过也留游荡痕迹（可观测）
    expect(ctx.wanderHistory.some((s) => s.tool === 'image_meme' && s.thought?.includes('[gated]'))).toBe(true);
  });

  it('#423 心情档位映射：excited 概率高于 emo（档位表约束）', async () => {
    // deps 必须在 createTool 前设好——工具创建时捕获依赖快照
    setImageMemeToolDeps({ buildDeps: () => makeDeps({ dataDir: dir }), buildCopy: () => COPY_GEN, rng: () => 0.5 });
    // emo p=0.1：rng=0.5 未命中
    const emoTool = imageMemeToolDef.createTool(makeCtx({ state: makeState({ mood: 'emo' }) }));
    let result = (await runTool(emoTool, { topic: '量子计算' })) as { ok: boolean; reason?: string };
    expect(result.ok).toBe(false);
    // excited p=0.6：同一 rng 命中，走完整管线
    const excitedTool = imageMemeToolDef.createTool(makeCtx({ state: makeState({ mood: 'excited' }) }));
    result = (await runTool(excitedTool, { topic: '量子计算' })) as { ok: boolean; reason?: string };
    expect(result.ok).toBe(true);
  });

  it('租户专属形象成功 → ok:true + imageUrl', async () => {
    const tool = imageMemeToolDef.createTool(makeCtx());
    // AI SDK tool：直接调用 execute（input 已 zod 校验）
    const result = (await runTool(tool, { topic: '量子计算' })) as { ok: boolean; id?: string; imageUrl?: string };
    expect(result.ok).toBe(true);
    expect(result.id).toBeTruthy();
    expect(result.imageUrl).toMatch(/\/api\/meme\/.*\/image\.png/);
    const historyFile = readdirSync(join(dir, 'history')).find((file) => file.startsWith('speaks-'));
    expect(historyFile).toBeTruthy();
    const history = JSON.parse(readFileSync(join(dir, 'history', historyFile!), 'utf8').trim()) as Record<string, unknown>;
    expect(history.memeId).toBe(result.id);
    expect(history.meme).toBe(true);
  });

  it('质检不过 → ok:false + 原因（不进图鉴）', async () => {
    setImageMemeToolDeps({
      rng: () => 0,
      buildDeps: () =>
        makeDeps({
          dataDir: dir,
          qc: { async inspect() { return { pass: false, issues: ['梗文字被切一半'] }; } },
        }),
      buildCopy: () => COPY_GEN,
    });
    const tool = imageMemeToolDef.createTool(makeCtx());
    const result = (await runTool(tool, { topic: 't' })) as { ok: boolean; reason?: string };
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
      rng: () => 0,
      buildDeps: () => makeDeps({ dataDir: dir, dailyLimit: 3 }),
      buildCopy: () => COPY_GEN,
    });
    const tool = imageMemeToolDef.createTool(makeCtx());
    const result = (await runTool(tool, { topic: 't' })) as { ok: boolean; reason?: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/配额/);
  });

  it('无当前租户角色 manifest → 显式拒绝，不尝试生图', async () => {
    const { unlinkSync } = await import('fs');
    unlinkSync(join(dir, 'pet-assets', 'manifest.json'));
    const tool = imageMemeToolDef.createTool(makeCtx());
    const result = (await runTool(tool, { topic: 't' })) as { ok: boolean; reason?: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('没有已交付');
  });

  it('生图失败 → ok:false', async () => {
    setImageMemeToolDeps({
      rng: () => 0,
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
    const result = (await runTool(tool, { topic: 't' })) as { ok: boolean; reason?: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('生图失败');
  });
});
