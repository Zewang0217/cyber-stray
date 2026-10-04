import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateOnce } from './candidate-store.js';

let dir: string;
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

describe('adoption candidate budget', () => {
  it('deduplicates concurrent requests and replays completed batches from disk', async () => {
    dir = await mkdtemp(join(tmpdir(), 'cp-candidates-'));
    const request = { step: 'name' as const, batch: 0 };
    const generate = vi.fn(async () => ({ candidates: ['煤球', '年糕', '团子'], source: 'llm' as const }));
    const result = await Promise.all(Array.from({ length: 8 }, () => generateOnce(dir, request, generate)));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.every((r) => r.candidates[0] === '煤球')).toBe(true);
    await expect(generateOnce(dir, request, generate)).resolves.toEqual(result[0]);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('counts server attempts even when the client keeps sending batch zero', async () => {
    dir = await mkdtemp(join(tmpdir(), 'cp-candidates-'));
    const generate = vi.fn(async () => ({ candidates: ['喵一下', '有货了', '还行吧'], source: 'llm' as const }));
    for (let n = 0; n < 4; n++) {
      await generateOnce(dir, { step: 'catchphrase', name: `猫${n}`, personality: 'curious', batch: 0 }, generate);
    }
    await expect(generateOnce(dir, { step: 'catchphrase', name: '猫5', batch: 0 }, generate)).rejects.toThrow('用完 4 批');
    expect(generate).toHaveBeenCalledTimes(4);
  });
  it('does not replay a failed or uncertain paid request after a restart', async () => {
    dir = await mkdtemp(join(tmpdir(), 'cp-candidates-'));
    const request = { step: 'name' as const, batch: 0 };
    const generate = vi.fn(async () => { throw new Error('upstream failed'); });
    await expect(generateOnce(dir, request, generate)).rejects.toThrow('upstream failed');
    await expect(generateOnce(dir, request, generate)).rejects.toThrow('未完成');
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
