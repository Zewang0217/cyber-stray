/**
 * 火山方舟生图客户端测试（#128）：mock fetch，不打真实 API
 *
 * 契约：同步生图（POST /images/generations → b64_json 落盘，无任务轮询）；
 * 参考图 data URL（image 字段）。视觉质检见 vision.test.ts。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createImageGenerator } from './ark.js';

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
