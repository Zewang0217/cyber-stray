import { describe, it, expect, vi } from 'vitest';
import { generateCandidates, parseCandidates } from './candidates.js';

const response = (content = '["煤球","年糕","小溜"]') => new Response(JSON.stringify({
  choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
}), { status: 200 });

describe('adoption candidate generation', () => {
  it('records real input/output usage before returning valid candidates', async () => {
    const onUsage = vi.fn(async () => {});
    const result = await generateCandidates({ step: 'name' }, 'test-key', { fetchFn: async () => response(), onUsage });
    expect(result).toEqual({ candidates: ['煤球', '年糕', '小溜'], source: 'llm' });
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 100, outputTokens: 20, tokens: 120 });
  });
  it('makes missing keys and provider failures visible without returning invented candidates', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 429 }));
    const opts = { fetchFn, onUsage: async () => {} };
    await expect(generateCandidates({ step: 'name' }, '', opts)).rejects.toThrow('API key');
    expect(fetchFn).not.toHaveBeenCalled();
    await expect(generateCandidates({ step: 'name' }, 'key', opts)).rejects.toThrow('429');
  });
  it('still accounts for a paid response whose candidate content is invalid', async () => {
    const onUsage = vi.fn(async () => {});
    await expect(generateCandidates({ step: 'name' }, 'key', {
      fetchFn: async () => response('["只有一条"]'), onUsage,
    })).rejects.toThrow('候选');
    expect(onUsage).toHaveBeenCalledTimes(1);
  });
  it('does not report success when accounting fails', async () => {
    await expect(generateCandidates({ step: 'name' }, 'key', {
      fetchFn: async () => response(), onUsage: async () => { throw new Error('ledger full'); },
    })).rejects.toThrow('ledger full');
  });
  it('requires a complete measured usage response and known model price', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ choices: [] })));
    const onUsage = vi.fn(async () => {});
    await expect(generateCandidates({ step: 'name' }, 'key', { fetchFn, onUsage })).rejects.toThrow();
    await expect(generateCandidates({ step: 'name' }, 'key', { model: 'unpriced', fetchFn, onUsage })).rejects.toThrow('未知模型单价');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(onUsage).not.toHaveBeenCalled();
  });
  it('validates exactly three nonempty short strings after removing JSON fences', () => {
    expect(parseCandidates('```json\n[" 煤球 ","年糕","小溜"]\n```')).toEqual(['煤球', '年糕', '小溜']);
    for (const raw of ['["a","b"]', '["a",1,"c"]', '["a"," ","c"]', 'not json']) {
      expect(parseCandidates(raw)).toBeNull();
    }
  });
});
