/**
 * 表情包管线端到端测试（#96）—— mock LLM/生图/叠加/质检
 *
 * 覆盖：
 * - 全链路成功：文案 → 生图 → 叠加 → 质检过 → 收录 manifest + 落盘成品图
 * - 图文分离：生图 prompt 不含文案文本（mock imageGen 捕获 prompt 断言）
 * - 质检不过 → rejected（不进 manifest，qcPass=false）
 * - 配额超限 → skipped（不消耗成本，不调生图）
 * - 生图失败 → failed
 * - IP 模式：参考图传入 imageGen
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMemePipeline } from './pipeline.js';
import { memeManifestPath, memeAssetsDir, loadManifest } from './storage.js';
import type { ImageGenerator, MemePipelineDeps } from './types.js';
import type { MemeCopy } from './types.js';

const COPY: MemeCopy = { text: '量子纠缠人生纠缠', emotion: '自嘲', topic: '量子计算' };

function fakeImageGen(captured: { prompts: string[]; refs: string[] }): ImageGenerator {
  return {
    async generate(req) {
      captured.prompts.push(req.prompt);
      if (req.reference) captured.refs.push(req.reference);
      writeFileSync(req.outPath, Buffer.from('FAKEIMG'));
      return { imagePath: req.outPath };
    },
  };
}

function fakeDeps(overrides: Partial<MemePipelineDeps> = {}): {
  deps: MemePipelineDeps;
  captured: { prompts: string[]; refs: string[] };
} {
  const captured = { prompts: [], refs: [] };
  const deps: MemePipelineDeps = {
    dataDir: '',
    imageGen: fakeImageGen(captured),
    overlay: {
      async apply(imagePath, text, outPath) {
        writeFileSync(outPath, Buffer.from(`${imagePath}|${text}`));
        return outPath;
      },
    },
    qc: { async inspect() { return { pass: true, issues: [] }; } },
    dailyLimit: 3,
    now: () => Date.UTC(2026, 7, 20),
    ...overrides,
  };
  return { deps, captured };
}

async function copyGen() {
  return COPY;
}

describe('runMemePipeline（端到端 mock）', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'meme-pipeline-'));
    mkdirSync(memeAssetsDir(dir), { recursive: true });
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('全链路成功 → recorded + 收录 manifest + 落盘成品图', async () => {
    const { deps } = fakeDeps({ dataDir: dir });
    const result = await runMemePipeline(deps, { topic: '量子计算', mode: 'abstract' }, copyGen);
    expect(result.status).toBe('recorded');
    if (result.status !== 'recorded') return;
    expect(result.meta.topic).toBe('量子计算');
    expect(result.meta.emotion).toBe('自嘲');
    expect(result.meta.date).toBe('2026-08-20');
    expect(result.meta.qcPass).toBe(true);
    const manifest = await loadManifest(dir);
    expect(manifest).toHaveLength(1);
    expect(manifest[0]?.id).toBe(result.meta.id);
    // 成品图落盘
    const finalPath = join(memeAssetsDir(dir), result.meta.file);
    expect(existsSync(finalPath)).toBe(true);
    // 叠加器收到了文案（图文分离：画面 → 叠加文字）
    const raw = readFileSync(finalPath, 'utf-8');
    expect(raw).toContain('量子纠缠人生纠缠');
  });

  it('图文分离：生图 prompt 不含文案文本', async () => {
    const { deps, captured } = fakeDeps({ dataDir: dir });
    await runMemePipeline(deps, { topic: '量子计算', mode: 'abstract' }, copyGen);
    expect(captured.prompts).toHaveLength(1);
    expect(captured.prompts[0]).not.toContain('量子纠缠');
    expect(captured.prompts[0]).toMatch(/不要任何文字/);
  });

  it('IP 模式：参考图传给 imageGen', async () => {
    const { deps, captured } = fakeDeps({ dataDir: dir });
    writeFileSync(join(dir, 'ref.jpg'), Buffer.from('REF'));
    await runMemePipeline(
      deps,
      { topic: '量子计算', mode: 'ip', referencePath: join(dir, 'ref.jpg') },
      copyGen,
    );
    expect(captured.refs).toEqual([join(dir, 'ref.jpg')]);
  });

  it('质检不过 → rejected（不进 manifest）', async () => {
    const { deps } = fakeDeps({
      dataDir: dir,
      qc: { async inspect() { return { pass: false, issues: ['梗文字被切一半'] }; } },
    });
    const result = await runMemePipeline(deps, { topic: 't', mode: 'abstract' }, copyGen);
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') return;
    expect(result.issues).toContain('梗文字被切一半');
    expect(await loadManifest(dir)).toHaveLength(0);
  });

  it('配额超限 → skipped（不调生图）', async () => {
    writeFileSync(
      memeManifestPath(dir),
      JSON.stringify([
        { id: 'a', date: '2026-08-20', qcPass: true },
        { id: 'b', date: '2026-08-20', qcPass: true },
        { id: 'c', date: '2026-08-20', qcPass: true },
      ]),
    );
    const { deps, captured } = fakeDeps({ dataDir: dir, dailyLimit: 3 });
    const result = await runMemePipeline(deps, { topic: 't', mode: 'abstract' }, copyGen);
    expect(result.status).toBe('skipped');
    if (result.status !== 'skipped') return;
    expect(result.reason).toMatch(/配额/);
    expect(captured.prompts).toHaveLength(0);
  });

  it('生图失败 → failed', async () => {
    const { deps } = fakeDeps({
      dataDir: dir,
      imageGen: {
        async generate() {
          throw new Error('DashScope 500');
        },
      },
    });
    const result = await runMemePipeline(deps, { topic: 't', mode: 'abstract' }, copyGen);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.error).toMatch(/生图失败.*DashScope 500/);
  });
});
