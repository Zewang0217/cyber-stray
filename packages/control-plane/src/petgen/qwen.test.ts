/**
 * DashScope 客户端测试（#94）：mock fetch，不打真实 API
 *
 * 契约：async 任务提交（X-DashScope-Async header）+ 轮询 + 下载落盘；
 * 参考图 base64 ≤61440 字符；qwen-vl 双图输入 + JSON 解析（容忍 markdown 围栏）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createImageGenerator, createVisionQc, parseQcJson, REFERENCE_BASE64_LIMIT } from './qwen.js';

const API_KEY = 'sk-test';

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
    tmp = mkdtempSync(join(tmpdir(), 'cp-petgen-qwen-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('缺 API key：构造不抛（不阻断 CP 启动），调用时显式失败', async () => {
    const gen = createImageGenerator('', { model: 'm', size: '1024*1024' });
    await expect(
      gen.generate({ kind: 'concept', prompt: '一只猫', outPath: join(tmp, 'x.png') }),
    ).rejects.toThrow(/DASHSCOPE_API_KEY/);
    const qc = createVisionQc('', { model: 'qwen-vl-max' });
    await expect(
      qc.inspect({
        referencePath: join(tmp, 'ref.png'),
        statePath: join(tmp, 'idle.png'),
        state: 'idle',
        spec: { specText: '猫' },
      }),
    ).rejects.toThrow(/DASHSCOPE_API_KEY/);
  });

  it('async 提交 → 轮询 SUCCEEDED → 下载落盘', async () => {
    const calls: string[] = [];
    const headersSeen: Array<Record<string, string>> = [];
    const bodiesSeen: string[] = [];
    const fetchFn = fakeFetch(
      [
        { status: 200, body: { output: { task_id: 'task-1', task_status: 'PENDING' } } },
        { status: 200, body: { output: { task_status: 'SUCCEEDED', results: [{ url: 'https://img/x.png' }] } } },
        { status: 200, raw: new Uint8Array([1, 2, 3, 4]) },
      ],
      (url, init) => {
        calls.push(url);
        headersSeen.push(Object.fromEntries(new Headers(init.headers).entries()));
        bodiesSeen.push(String(init.body ?? ''));
      },
    );
    const gen = createImageGenerator(API_KEY, {
      model: 'wanx2.1-t2i-turbo',
      size: '1024*1024',
      fetchFn,
      sleep: async () => {},
    });
    const out = join(tmp, 'concept-raw.png');
    const result = await gen.generate({ kind: 'concept', prompt: '一只猫', outPath: out });

    expect(calls[0]).toContain('/image-synthesis');
    expect(calls[1]).toContain('/tasks/task-1');
    expect(headersSeen[0]?.['x-dashscope-async']).toBe('enable');
    expect(headersSeen[0]?.['authorization']).toBe(`Bearer ${API_KEY}`);
    const submitBody = JSON.parse(bodiesSeen[0] ?? '{}') as Record<string, unknown>;
    expect(submitBody.model).toBe('wanx2.1-t2i-turbo');
    expect((submitBody.input as { prompt: string }).prompt).toBe('一只猫');
    expect((submitBody.parameters as { size: string }).size).toBe('1024*1024');
    expect(result.imagePath).toBe(out);
    expect(existsSync(out)).toBe(true);
    expect([...readFileSync(out)]).toEqual([1, 2, 3, 4]);
  });

  it('任务 FAILED → 抛错含原因', async () => {
    const fetchFn = fakeFetch([
      { status: 200, body: { output: { task_id: 't', task_status: 'PENDING' } } },
      { status: 200, body: { output: { task_status: 'FAILED', message: '内容违规' } } },
    ]);
    const gen = createImageGenerator(API_KEY, {
      model: 'm',
      size: '1024*1024',
      fetchFn,
      sleep: async () => {},
    });
    await expect(gen.generate({ kind: 'grid', prompt: 'x', outPath: join(tmp, 'g.png') })).rejects.toThrow(
      /内容违规/,
    );
  });

  it('轮询超时 → 抛错', async () => {
    const fetchFn = fakeFetch([
      { status: 200, body: { output: { task_id: 't', task_status: 'RUNNING' } } },
      { status: 200, body: { output: { task_status: 'RUNNING' } } },
    ]);
    const gen = createImageGenerator(API_KEY, {
      model: 'm',
      size: '1024*1024',
      fetchFn,
      sleep: async () => {}, // 不推进真实时间 → deadline 立即到达
      pollTimeoutMs: 0,
      pollIntervalMs: 10_000,
    });
    await expect(gen.generate({ kind: 'grid', prompt: 'x', outPath: join(tmp, 'g.png') })).rejects.toThrow(
      /超时/,
    );
  });

  it('参考图 base64 超限 → 显式抛错', async () => {
    // 50000 字节随机 → base64 ≈ 66668 > 61440
    const big = Buffer.alloc(50_000, 7);
    writeFileSync(join(tmp, 'ref.jpg'), big);
    expect(Buffer.from(readFileSync(join(tmp, 'ref.jpg'))).toString('base64').length).toBeGreaterThan(
      REFERENCE_BASE64_LIMIT,
    );
    const fetchFn = fakeFetch([
      { status: 200, body: { output: { task_id: 't', task_status: 'SUCCEEDED' } } },
    ]);
    const gen = createImageGenerator(API_KEY, { model: 'm', size: '1024*1024', fetchFn, sleep: async () => {} });
    await expect(
      gen.generate({
        kind: 'grid',
        prompt: 'x',
        outPath: join(tmp, 'g.png'),
        reference: join(tmp, 'ref.jpg'),
      }),
    ).rejects.toThrow(/超过 DashScope 上限/);
  });
});

describe('createVisionQc', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cp-petgen-vl-'));
    // 1x1 透明 PNG
    writeFileSync(join(tmp, 'concept.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
    writeFileSync(join(tmp, 'idle.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('双图 dataURL + JSON 输出解析', async () => {
    let seenBody = '';
    const fetchFn = fakeFetch(
      [{ status: 200, body: { output: { choices: [{ message: { content: [{ text: '```json\n{"pass": false, "issues": ["有文字水印"]}\n```' }] } }] } } }],
      (_url, init) => {
        seenBody = String(init.body);
      },
    );
    const qc = createVisionQc(API_KEY, { model: 'qwen-vl-max', fetchFn });
    const result = await qc.inspect({
      referencePath: join(tmp, 'concept.png'),
      statePath: join(tmp, 'idle.png'),
      state: 'idle',
      spec: { specText: '一只猫' },
    });
    expect(result).toEqual({ pass: false, issues: ['有文字水印'] });
    expect(seenBody).toContain('data:image/png;base64,');
    expect(seenBody).toContain('qwen-vl-max');
    expect(seenBody).toContain('待机呼吸');
  });

  it('质检响应非 JSON → 抛错（禁兜底）', async () => {
    const fetchFn = fakeFetch([{ status: 200, body: { output: { choices: [{ message: { content: [{ text: '我看不清' }] } }] } } }]);
    const qc = createVisionQc(API_KEY, { model: 'qwen-vl-max', fetchFn });
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
