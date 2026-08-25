/**
 * 用量记录测试（#129，控制面侧）—— petgen recorder 落租户 usage JSONL
 *
 * 契约：recordUsage 写 tenants/<sub>/usage/usage-YYYY-MM-DD.jsonl；
 * createPetUsageRecorder 闭包绑定模型名，recordImage/recordVision 记张数。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createPetUsageRecorder, localDateKey } from './usage.js';

describe('createPetUsageRecorder', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-usage-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('recordImage/recordVision 写对租户目录，模型名闭包绑定', async () => {
    const recorder = createPetUsageRecorder(dataDir, {
      imageModel: 'doubao-seedream-5-0-260128',
      visionModel: 'glm-4v-flash',
    });
    recorder.recordImage('sub-1');
    recorder.recordVision('sub-1');
    // 等待异步落盘（no-throw fire-and-forget；两行并发 append，顺序不保证）
    await new Promise((r) => setTimeout(r, 100));

    const file = join(dataDir, 'tenants', 'sub-1', 'usage', `usage-${localDateKey()}.jsonl`);
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, 'utf-8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(2);

    const image = lines.find((l) => l.kind === 'image');
    expect(image).toBeDefined();
    expect(image!.model).toBe('doubao-seedream-5-0-260128');
    expect(image!.images).toBe(1);
    expect(image!.tenantId).toBe('sub-1');

    const vision = lines.find((l) => l.kind === 'vision_qc');
    expect(vision).toBeDefined();
    expect(vision!.model).toBe('glm-4v-flash');
  });

  it('不同租户写入各自目录（隔离）', async () => {
    const recorder = createPetUsageRecorder(dataDir, { imageModel: 'm', visionModel: 'v' });
    recorder.recordImage('a');
    recorder.recordImage('b');
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(dataDir, 'tenants', 'a', 'usage'))).toBe(true);
    expect(existsSync(join(dataDir, 'tenants', 'b', 'usage'))).toBe(true);
    expect(
      readFileSync(join(dataDir, 'tenants', 'a', 'usage', `usage-${localDateKey()}.jsonl`), 'utf-8')
        .trim()
        .split('\n'),
    ).toHaveLength(1);
  });
});
