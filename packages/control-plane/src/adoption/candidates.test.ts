/**
 * 领养候选生成测试（#114 切片 3）
 *
 * 契约：
 * - parseCandidates：恰 3 条非空字符串（剥 code fence）；其他形态全 null
 * - fallbackCandidates：name 按 batch 轮换；catchphrase = 性格默认组文本
 * - generateCandidates：无 key 直接降级；LLM 正常返回走 llm；
 *   非 2xx / 坏 JSON / 网络错 → 降级且不抛
 */

import { describe, it, expect } from 'vitest';
import { getPersonality } from '@cyber-stray/shared';
import {
  fallbackCandidates,
  generateCandidates,
  parseCandidates,
} from './candidates.js';

describe('parseCandidates', () => {
  it('恰 3 条非空字符串（含 code fence 剥离 + trim）', () => {
    expect(parseCandidates('```json\n[" 煤球 ", "年糕", "小溜"]\n```')).toEqual([
      '煤球',
      '年糕',
      '小溜',
    ]);
  });

  it('非 3 条 / 非字符串 / 超 24 字 / 坏 JSON → null', () => {
    expect(parseCandidates('["a", "b"]')).toBeNull();
    expect(parseCandidates('["a", "b", "c", "d"]')).toBeNull();
    expect(parseCandidates('["a", 1, "c"]')).toBeNull();
    expect(parseCandidates('["a", "", "c"]')).toBeNull();
    expect(parseCandidates(`["a", "${'x'.repeat(25)}", "c"]`)).toBeNull();
    expect(parseCandidates('不是 JSON')).toBeNull();
    expect(parseCandidates('{"candidates":["a","b","c"]}')).toBeNull();
  });
});

describe('fallbackCandidates', () => {
  it('name 按 batch 轮换本地模板池', () => {
    const b0 = fallbackCandidates({ step: 'name', batch: 0 });
    const b1 = fallbackCandidates({ step: 'name', batch: 1 });
    expect(b0).toHaveLength(3);
    expect(b1).toHaveLength(3);
    expect(b0).not.toEqual(b1);
  });

  it('catchphrase 降级 = 性格默认组文本', () => {
    for (const personality of ['curious', 'playful', 'lazy', 'steady'] as const) {
      const out = fallbackCandidates({ step: 'catchphrase', personality });
      expect(out).toEqual(getPersonality(personality).catchphrases.map((c) => c.text));
    }
  });
});

describe('generateCandidates', () => {
  const okResponse = (
    _input: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> =>
    Promise.resolve(
      new Response(
        JSON.stringify({ choices: [{ message: { content: '["煤球","年糕","小溜"]' } }] }),
        { status: 200 },
      ),
    );

  it('无 key → 直接降级，不发请求', async () => {
    const fetchFn = () => {
      throw new Error('不应发请求');
    };
    const result = await generateCandidates({ step: 'name' }, '', { fetchFn });
    expect(result.source).toBe('fallback');
    expect(result.candidates).toHaveLength(3);
  });

  it('LLM 正常返回 → source=llm', async () => {
    const result = await generateCandidates({ step: 'name' }, 'sk-test', { fetchFn: okResponse });
    expect(result).toEqual({ candidates: ['煤球', '年糕', '小溜'], source: 'llm' });
  });

  it('非 2xx / 坏 JSON / 网络错 → 降级不抛', async () => {
    const badStatus = new Response('rate limited', { status: 429 });
    const fetchFns: Array<(input: string | URL | Request, init?: RequestInit) => Promise<Response>> = [
      () => Promise.resolve(badStatus),
      () => Promise.resolve(new Response('not json', { status: 200 })),
      () => Promise.reject(new Error('network down')),
    ];
    for (const fetchFn of fetchFns) {
      const result = await generateCandidates({ step: 'name' }, 'sk-test', { fetchFn });
      expect(result.source).toBe('fallback');
      expect(result.candidates).toHaveLength(3);
    }
  });

  it('LLM 返回坏内容（2 条）→ 降级', async () => {
    const fetchFn = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '["只有一条","第二条"]' } }] }),
          { status: 200 },
        ),
      );
    const result = await generateCandidates({ step: 'name' }, 'sk-test', { fetchFn });
    expect(result.source).toBe('fallback');
  });
});
