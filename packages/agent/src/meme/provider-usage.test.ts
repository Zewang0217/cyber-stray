import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createImageGenerator } from './ark.js';
import { createVisionQc } from './vision.js';
import { localDateKey, withImageUsageTracking, withVisionUsageTracking } from '../usage/usage.js';
import { useTempDataDir } from '../test/helpers.js';

describe('表情包实际付费响应计量', () => {
  let dataDir: string;
  let cleanup: () => void;
  beforeEach(() => { ({ dataDir, cleanup } = useTempDataDir()); });
  afterEach(() => cleanup());
  const imageModel = 'doubao-seedream-5-0-260128';
  const visionModel = 'glm-4v-flash';
  async function rows() {
    return (await readFile(join(dataDir, 'usage', `usage-${localDateKey()}.jsonl`), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line));
  }

  it.each(['bad-json', 'disk-failure', 'success'])('HTTP 成功后 %s 仍只计一次生图用量', async (mode) => {
    const fetchFn = vi.fn(async () => new Response(mode === 'bad-json' ? '{invalid'
      : JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] })));
    const generator = withImageUsageTracking(createImageGenerator('test-key', {
      model: imageModel, size: '2K', fetchFn: fetchFn as unknown as typeof fetch,
    }), dataDir, imageModel);
    const req = { prompt: 'test', outPath: join(dataDir, mode === 'disk-failure' ? 'missing/image.png' : 'image.png') };
    if (mode === 'success') await generator.generate(req);
    else await expect(generator.generate(req)).rejects.toThrow();
    expect(await rows()).toMatchObject([{ kind: 'image', images: 1 }]);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('质检 HTTP 成功但内容无效仍计量', async () => {
    const imagePath = join(dataDir, 'image.png');
    await writeFile(imagePath, 'image');
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'invalid json' } }] })));
    const vision = withVisionUsageTracking(createVisionQc('test-key', {
      model: visionModel, fetchFn: fetchFn as unknown as typeof fetch,
    }), dataDir, visionModel);
    const req = { imagePath, copy: { text: 'test', emotion: 'happy', topic: 'test' }, mode: 'abstract' as const };
    await expect(vision(req)).rejects.toThrow('非 JSON');
    expect(await rows()).toMatchObject([{ kind: 'vision_qc', images: 1 }]);
  });

  it.each(['image', 'vision'])('%s 记账失败后不解析结果、不再次调用付费服务', async (kind) => {
    const imagePath = join(dataDir, 'image.png');
    await writeFile(imagePath, 'image');
    await writeFile(join(dataDir, 'usage'), 'blocked');
    const fetchFn = vi.fn(async () => new Response('{invalid'));
    const generator = withImageUsageTracking(createImageGenerator('test-key', {
      model: imageModel, size: '2K', fetchFn: fetchFn as unknown as typeof fetch,
    }), dataDir, imageModel);
    const vision = withVisionUsageTracking(createVisionQc('test-key', {
      model: visionModel, fetchFn: fetchFn as unknown as typeof fetch,
    }), dataDir, visionModel);
    const invoke = () => kind === 'image'
      ? generator.generate({ prompt: 'test', outPath: join(dataDir, 'out.png') })
      : vision({ imagePath, copy: { text: 'test', emotion: 'happy', topic: 'test' }, mode: 'abstract' });
    await expect(invoke()).rejects.toThrow('用量记账失败');
    await expect(invoke()).rejects.toThrow('用量记账失败');
    expect(fetchFn).toHaveBeenCalledOnce();
  });
});
