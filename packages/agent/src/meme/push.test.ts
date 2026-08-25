/**
 * 表情包推送补发测试（#96）
 *
 * recordMemeForPush：写一条可通知 speak 记录（Web Push 送达），
 * 含标题/摘要/URL 指向图鉴页；失败显式抛错（禁兜底）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, readdir, mkdir } from 'fs/promises';
import { join } from 'path';
import { useTempDataDir } from '../test/helpers.js';
import { recordMemeForPush, MEME_GALLERY_URL } from './push.js';
import type { MemeMeta } from './types.js';

describe('recordMemeForPush', () => {
  let dataDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const temp = useTempDataDir();
    dataDir = temp.dataDir;
    cleanup = temp.cleanup;
  });

  afterEach(() => cleanup());

  it('写 notifiable speak 记录（pushed=false，URL 指向图鉴页）', async () => {
    const meta: MemeMeta = {
      id: 'aaaaaaaa-0000-0000-0000-000000000001',
      topic: '量子计算',
      emotion: '自嘲',
      date: '2026-08-20',
      mode: 'abstract',
      file: 'meme-a.png',
      qcPass: true,
      createdAt: Date.UTC(2026, 7, 20, 12),
    };
    const { file } = await recordMemeForPush(meta);
    expect(file).toContain('speaks-');
    const files = await readdir(join(dataDir, 'history'));
    expect(files.some((f) => f.startsWith('speaks-'))).toBe(true);
    const content = await readFile(file, 'utf-8');
    const record = JSON.parse(content.split('\n').filter(Boolean).pop() ?? '{}') as Record<string, unknown>;
    expect(record.gated).toBe(false);
    expect(record.planLimited).toBe(false);
    expect(record.pushed).toBe(false); // 交给 push-gateway 送达
    expect(record.url).toBe(MEME_GALLERY_URL);
    expect(record.title).toContain('自嘲');
    expect(record.content).toContain('量子计算');
  });
});
