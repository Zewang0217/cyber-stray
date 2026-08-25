/**
 * 视觉质检客户端测试（#128）：mock fetch，不打真实 API
 *
 * 契约：OpenAI 兼容 chat/completions（content 数组 + image_url data URL）→
 * content 字符串 + JSON 解析（容忍 markdown 围栏）；baseUrl 默认智谱、可配置。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createVisionQc, parseQcJson, DEFAULT_VISION_BASE_URL } from './vision.js';

const API_KEY = 'zhipu-test';
// 1x1 透明 PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** 顺序响应的 fake fetch */
function fakeFetch(
  responses: Array<{ status: number; body?: unknown }>,
  onCall?: (url: string, init: RequestInit) => void,
): typeof fetch {
  let call = 0;
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const r = responses[call];
    call += 1;
    onCall?.(u, init ?? {});
    if (!r) throw new Error(`fake fetch 超出响应数: ${u}`);
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('createVisionQc', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cp-petgen-vision-'));
    writeFileSync(join(tmp, 'concept.png'), Buffer.from(PNG_B64, 'base64'));
    writeFileSync(join(tmp, 'idle.png'), Buffer.from(PNG_B64, 'base64'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('缺 API key：构造不抛，调用时显式失败', async () => {
    const qc = createVisionQc('', { model: 'glm-4v-flash' });
    await expect(
      qc.inspect({
        referencePath: join(tmp, 'concept.png'),
        statePath: join(tmp, 'idle.png'),
        state: 'idle',
        spec: { specText: '猫' },
      }),
    ).rejects.toThrow(/ZHIPU_API_KEY/);
  });

  it('默认智谱端点 + OpenAI content 数组 + JSON 输出解析', async () => {
    let seenUrl = '';
    let seenBody = '';
    const fetchFn = fakeFetch(
      [{ status: 200, body: { choices: [{ message: { content: '```json\n{"pass": false, "issues": ["有文字水印"]}\n```' } }] } }],
      (url, init) => {
        seenUrl = url;
        seenBody = String(init.body);
      },
    );
    const qc = createVisionQc(API_KEY, { model: 'glm-4v-flash', fetchFn });
    const result = await qc.inspect({
      referencePath: join(tmp, 'concept.png'),
      statePath: join(tmp, 'idle.png'),
      state: 'idle',
      spec: { specText: '一只猫' },
    });
    expect(result).toEqual({ pass: false, issues: ['有文字水印'] });
    expect(seenUrl).toBe(`${DEFAULT_VISION_BASE_URL}/chat/completions`);
    expect(seenBody).toContain('glm-4v-flash');
    const body = JSON.parse(seenBody) as { messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }> };
    const content = body.messages[0]!.content;
    expect(content[0]).toMatchObject({ type: 'image_url' });
    expect(content[0]!.image_url!.url).toContain('data:image/png;base64,');
    expect(content[2]).toMatchObject({ type: 'text' });
  });

  it('baseUrl 可配置（供应商切换零代码）', async () => {
    let seenUrl = '';
    const fetchFn = fakeFetch(
      [{ status: 200, body: { choices: [{ message: { content: '{"pass": true, "issues": []}' } }] } }],
      (url) => {
        seenUrl = url;
      },
    );
    const qc = createVisionQc(API_KEY, { model: 'other-vl', baseUrl: 'https://example.com/v1', fetchFn });
    await qc.inspect({
      referencePath: join(tmp, 'concept.png'),
      statePath: join(tmp, 'idle.png'),
      state: 'idle',
      spec: { specText: '一只猫' },
    });
    expect(seenUrl).toBe('https://example.com/v1/chat/completions');
  });

  it('质检响应非 JSON → 抛错（禁兜底）', async () => {
    const fetchFn = fakeFetch([{ status: 200, body: { choices: [{ message: { content: '我看不清' } }] } }]);
    const qc = createVisionQc(API_KEY, { model: 'glm-4v-flash', fetchFn });
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
