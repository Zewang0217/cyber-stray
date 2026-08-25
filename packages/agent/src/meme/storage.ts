/**
 * 表情包存储（#96）—— 租户私有 meme-assets/ 目录
 *
 * 落盘契约（对齐 CP 图鉴路由读取）：
 * - meme-assets/manifest.json：收录索引（元数据数组，图鉴 API 读它列表情包）
 * - meme-assets/meme-<id>.png：成品图
 *
 * 原子写（tmp + rename）：manifest 更新防半写被消费方读到。索引复用？——
 * 图鉴是独立元数据（非记忆），不套 MemoryIndex；manifest 单文件足够（表情包
 * 量级小，全量读写可接受）。
 */

import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { MemeMeta, MemeMode } from './types.js';

/** 表情包资源目录（相对租户数据根） */
export const MEME_ASSETS_DIR = 'meme-assets';

/** manifest 文件名 */
const MANIFEST = 'manifest.json';

/** 生成成品文件名（meme-<id>.png） */
export function memeFileName(id: string): string {
  return `meme-${id}.png`;
}

/** 资源目录绝对路径 */
export function memeAssetsDir(dataDir: string): string {
  return join(dataDir, MEME_ASSETS_DIR);
}

/** manifest 绝对路径 */
export function memeManifestPath(dataDir: string): string {
  return join(memeAssetsDir(dataDir), MANIFEST);
}

/** 读 manifest（缺失 = 空数组；损坏 = 显式抛错——禁兜底，防丢数据被静默） */
export async function loadManifest(dataDir: string): Promise<MemeMeta[]> {
  const path = memeManifestPath(dataDir);
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`表情包 manifest 损坏（非数组）: ${path}`);
  }
  return parsed as MemeMeta[];
}

/** 追加一条元数据到 manifest（原子写；保留原顺序，新条目在后） */
export async function appendManifest(dataDir: string, meta: MemeMeta): Promise<void> {
  const dir = memeAssetsDir(dataDir);
  const path = memeManifestPath(dataDir);
  await mkdir(dir, { recursive: true });
  const existing = await loadManifest(dataDir);
  existing.push(meta);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(existing, null, 2), 'utf-8');
  await rename(tmp, path);
}

/** 创建一条新元数据（id/文件名/日期由这里派生，供 pipeline 与推送引用） */
export function buildMemeMeta(input: {
  topic: string;
  emotion: string;
  date: string;
  mode: MemeMode;
  qcPass: boolean;
  now?: number;
}): MemeMeta {
  const id = randomUUID();
  return {
    id,
    topic: input.topic,
    emotion: input.emotion,
    date: input.date,
    mode: input.mode,
    file: memeFileName(id),
    qcPass: input.qcPass,
    createdAt: input.now ?? Date.now(),
  };
}
