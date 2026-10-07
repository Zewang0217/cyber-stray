import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVisionQc } from './vision.js';

let dir: string | undefined;
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

describe('表情包视觉质检', () => {
  it('使用参考图与成品图，并携带 CP 同款思考/温度参数', async () => {
    dir = await mkdtemp(join(tmpdir(), 'meme-vision-'));
    const referencePath = join(dir, 'reference.jpg');
    const imagePath = join(dir, 'meme.png');
    await writeFile(referencePath, 'reference');
    await writeFile(imagePath, 'meme');
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"pass":true,"issues":[]}' } }],
    }), { status: 200 }));
    const qc = createVisionQc('test-key', {
      model: 'ecnu-plus', baseUrl: 'https://chat.ecnu.edu.cn/open/api/v1',
      thinking: true, temperature: 0, fetchFn: fetchFn as typeof fetch,
    });
    await expect(qc({ referencePath, imagePath, copy: { topic: '测试', text: '有梗', emotion: '开心', scene: '猫抱着键盘跳舞' },
      mode: 'ip' })).resolves.toEqual({ pass: true, issues: [] });
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://chat.ecnu.edu.cn/open/api/v1/chat/completions');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'ecnu-plus', thinking: { type: 'enabled' },
      reasoning_effort: 'medium', temperature: 0 });
    expect((body.messages as Array<{ content: unknown[] }>)[0]?.content).toHaveLength(3);
  });
});
