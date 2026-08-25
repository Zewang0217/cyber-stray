/**
 * 火山方舟客户端测试（#128）：mock fetch，不打真实 API
 *
 * 契约：同步生图（POST /images/generations → b64_json 落盘，无任务轮询）；
 * 参考图 data URL（image 字段）；豆包视觉（OpenAI 兼容 chat/completions，
 * content 数组 + image_url）→ content 字符串 + JSON 解析（容忍 markdown 围栏）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createImageGenerator, createVisionQc, parseQcJson } from './ark.js';

const API_KEY = 'ark-test';

/** 顺序响应的 fake fetch */
function fakeFetch(
  responses: Array<{ status: number; body?: unknown; raw?: Uint8Array }>,
  onCall?: (url: string, init: RequestInit) => void,
): typeof fetch {
  let call = 0;
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const r = responses[call];
    call += 1;
    onCall?.(u, init ?? {});
    if (!r) throw new Error(`fake fetch 超出响应数: ${u}`);
    const res = new Response(
      r.raw ? new Uint8Array(r.raw) : JSON.stringify(r.body ?? {}),
      { status: r.status, headers: { 'content-type': 'application/json' } },
    );
    return res;
  }) as typeof fetch;
}

describe('createImageGenerator', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cp-petgen-ark-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('缺 API key：构造不抛（不阻断 CP 启动），调用时显式失败', async () => {
    const gen = createImageGenerator('', { model: 'm', size: '2K' });
    await expect(
      gen.generate({ kind: 'concept', prompt: '一只猫', outPath: join(tmp, 'x.png') }),
    ).rejects.toThrow(/ARK_API_KEY/);
    const qc = createVisionQc('', { model: 'doubao-1.5-vision-pro' });
    await expect(
      qc.inspect({
        referencePath: join(tmp, 'ref.png'),
        statePath: join(tmp, 'idle.png'),
        state: 'idle',
        spec: { specText: '猫' },
      }),
    ).rejects.toThrow(/ARK_API_KEY/);
  });

  it('同步生图 → b64_json 落盘（无轮询、无下载）', async () => {
    const calls: string[] = [];
    const headersSeen: Array<Record<string, string>> = [];
    const bodiesSeen: string[] = [];
    const pngB64 = Buffer.from([1, 2, 3, 4]).toString('base64');
    const fetchFn = fakeFetch(
      [{ status: 200, body: { data: [{ b64_json: pngB64 }] } }],
      (url, init) => {
        calls.push(url);
        headersSeen.push(Object.fromEntries(new Headers(init.headers).entries()));
        bodiesSeen.push(String(init.body ?? ''));
      },
    );
    const gen = createImageGenerator(API_KEY, { model: 'doubao-seedream-5-0-260128', size: '2K', fetchFn });
    const out = join(tmp, 'concept-raw.png');
    const result = await gen.generate({ kind: 'concept', prompt: '一只猫', outPath: out });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/images/generations');
    expect(headersSeen[0]?.['authorization']).toBe(`Bearer ${API_KEY}`);
    const body = JSON.parse(bodiesSeen[0] ?? '{}') as Record<string, unknown>;
    expect(body.model).toBe('doubao-seedream-5-0-260128');
    expect(body.prompt).toBe('一只猫');
    expect(body.size).toBe('2K');
    expect(body.response_format).toBe('b64_json');
    expect(body.watermark).toBe(false);
    expect(result.imagePath).toBe(out);
    expect(existsSync(out)).toBe(true);
    expect([...readFileSync(out)]).toEqual([1, 2, 3, 4]);
  });

  it('参考图 → data URL（image 字段，mime 按扩展名）', async () => {
    writeFileSync(join(tmp, 'ref.jpg'), Buffer.from([9, 9, 9]));
    let seenBody = '';
    const fetchFn = fakeFetch(
      [{ status: 200, body: { data: [{ b64_json: Buffer.from([1]).toString('base64') }] } }],
      (_url, init) => {
        seenBody = String(init.body);
      },
    );
    const gen = createImageGenerator(API_KEY, { model: 'm', size: '2K', fetchFn });
    await gen.generate({
      kind: 'grid',
      prompt: 'x',
      outPath: join(tmp, 'g.png'),
      reference: join(tmp, 'ref.jpg'),
    });
    const body = JSON.parse(seenBody) as { image: string };
    expect(body.image).toMatch(/^data:image\/jpeg;base64,/);
    expect(body.image).toContain(Buffer.from([9, 9, 9]).toString('base64'));
  });

  it('HTTP 4xx（含内容审核拦截）→ 显式抛错', async () => {
    const fetchFn = fakeFetch([{ status: 400, body: { error: { message: '内容违规' } } }]);
    const gen = createImageGenerator(API_KEY, { model: 'm', size: '2K', fetchFn });
    await expect(gen.generate({ kind: 'grid', prompt: 'x', outPath: join(tmp, 'g.png') })).rejects.toThrow(
      /内容违规/,
    );
  });

  it('响应无 b64_json → 显式抛错（禁兜底）', async () => {
    const fetchFn = fakeFetch([{ status: 200, body: { data: [{ url: 'https://img/x.png' }] } }]);
    const gen = createImageGenerator(API_KEY, { model: 'm', size: '2K', fetchFn });
    await expect(gen.generate({ kind: 'grid', prompt: 'x', outPath: join(tmp, 'g.png') })).rejects.toThrow(
      /无 b64_json/,
    );
  });
});

describe('createVisionQc', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cp-petgen-ark-vl-'));
    // 1x1 透明 PNG
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    writeFileSync(join(tmp, 'concept.png'), Buffer.from(png, 'base64'));
    writeFileSync(join(tmp, 'idle.png'), Buffer.from(png, 'base64'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('双图 data URL + OpenAI content 数组 + JSON 输出解析', async () => {
    let seenBody = '';
    let seenUrl = '';
    const fetchFn = fakeFetch(
      [{ status: 200, body: { choices: [{ message: { content: '```json\n{"pass": false, "issues": ["有文字水印"]}\n```' } }] } }],
      (url, init) => {
        seenUrl = url;
        seenBody = String(init.body);
      },
    );
    const qc = createVisionQc(API_KEY, { model: 'doubao-1.5-vision-pro', fetchFn });
    const result = await qc.inspect({
      referencePath: join(tmp, 'concept.png'),
      statePath: join(tmp, 'idle.png'),
      state: 'idle',
      spec: { specText: '一只猫' },
    });
    expect(result).toEqual({ pass: false, issues: ['有文字水印'] });
    expect(seenUrl).toContain('/chat/completions');
    expect(seenBody).toContain('doubao-1.5-vision-pro');
    const body = JSON.parse(seenBody) as { messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }> };
    const content = body.messages[0]!.content;
    expect(content[0]).toMatchObject({ type: 'image_url' });
    expect(content[0]!.image_url!.url).toContain('data:image/png;base64,');
    expect(content[2]).toMatchObject({ type: 'text' });
  });

  it('质检响应非 JSON → 抛错（禁兜底）', async () => {
    const fetchFn = fakeFetch([{ status: 200, body: { choices: [{ message: { content: '我看不清' } }] } }]);
    const qc = createVisionQc(API_KEY, { model: 'doubao-1.5-vision-pro', fetchFn });
    await expect(
      qc.inspect({
        referencePath: join(tmp, 'concept.png'),
        statePath: join(tmp, 'idle.png'),
        state: 'idle',
        spec: { specText: '一只猫' },
      }),
    ).rejects.toThrow(/非 JSON/);
  });
});

describe('parseQcJson', () => {
  it('容忍 markdown 围栏与空白', () => {
    expect(parseQcJson('```json\n{"pass": true, "issues": []}\n```')).toEqual({ pass: true, issues: [] });
    expect(parseQcJson('{"pass": false, "issues": ["a", "b"]}')).toEqual({ pass: false, issues: ['a', 'b'] });
  });

  it('缺字段 → 抛错', () => {
    expect(() => parseQcJson('{"ok": true}')).toThrow(/缺字段/);
  });
});
