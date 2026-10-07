import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preparePetMemeReference, resolvePetReference } from './reference.js';

describe('当前租户表情包角色参考图', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'pet-meme-reference-'));
    await mkdir(join(dataDir, 'pet-assets'));
  });
  afterEach(async () => { await rm(dataDir, { recursive: true, force: true }); });

  it('仅领养参考图存在时从已交付 manifest 读取同租户角色', async () => {
    await writeFile(join(dataDir, 'pet-assets', 'manifest.json'), JSON.stringify({
      version: 2, spec: { specText: '蓝色小狗，白耳朵' },
    }));
    await writeFile(join(dataDir, 'pet-assets', 'adopt-reference.jpg'), 'reference');
    expect(await preparePetMemeReference(dataDir)).toEqual({
      path: join(dataDir, 'pet-assets', 'adopt-reference.jpg'), specText: '蓝色小狗，白耳朵',
    });
    expect(await readFile(join(dataDir, 'pet-assets', 'adopt-reference.jpg'), 'utf8')).toBe('reference');
  });

  it('概念图由 manifest 指定，非法文件名不能穿越租户目录', async () => {
    await writeFile(join(dataDir, 'pet-assets', 'manifest.json'), JSON.stringify({
      version: 1, spec: { specText: '橙色小龙' }, concept: '../other.png',
    }));
    await expect(resolvePetReference(dataDir)).rejects.toThrow();
  });

  it('没有已交付 manifest 时返回空，不借用平台内置宠物', async () => {
    expect(await resolvePetReference(dataDir)).toBeNull();
  });
});
