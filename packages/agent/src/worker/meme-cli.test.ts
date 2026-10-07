import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setTenantContext, loadConfig } from '../config.js';
import { publishRecordedMeme } from './meme-cli.js';
import { appendManifest, memeFileName } from '../meme/storage.js';

const ID = 'aaaaaaaa-0000-0000-0000-000000000001';
let root: string | undefined;
afterEach(async () => {
  setTenantContext(null);
  if (root) await rm(root, { recursive: true, force: true });
});

describe('正式已生成表情包发布入口', () => {
  it('仅已过质检的本租户 IP 图可落墙，重试不重复写历史', async () => {
    root = await mkdtemp(join(tmpdir(), 'meme-publish-'));
    const dir = join(root, 'tenants', 'tenant-a');
    await mkdir(dir, { recursive: true });
    setTenantContext({ tenantId: 'tenant-a', dataDir: dir, config: loadConfig(dir) });
    await expect(publishRecordedMeme(dir, ID)).rejects.toThrow(/没有已通过质检/);
    await appendManifest(dir, { id: ID, topic: '黑猫的夜间研究', emotion: '机灵',
      date: '2026-10-07', mode: 'ip', file: memeFileName(ID), qcPass: true, createdAt: Date.now() });
    await writeFile(join(dir, 'meme-assets', memeFileName(ID)), 'PNG');
    await expect(publishRecordedMeme(dir, ID)).resolves.toBe('published');
    await expect(publishRecordedMeme(dir, ID)).resolves.toBe('already-published');
    const files = await readdir(join(dir, 'history'));
    const history = await readFile(join(dir, 'history', files[0]!), 'utf8');
    expect(history.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(history.trim())).toMatchObject({ memeId: ID, meme: true, notify: false });
  });
});
