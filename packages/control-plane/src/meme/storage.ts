/**
 * 表情包存储（#96 CP 侧）—— 读 agent 生成的 meme-assets/ 契约
 *
 * 生成管线在 agent 包（睡前任务/image_meme 工具）落盘：
 * - meme-assets/manifest.json：收录索引（元数据数组，图鉴 API 读它）
 * - meme-assets/meme-<id>.png：成品图
 * CP 只读（列表/服务图片/删除），不写生成——职责边界：agent 产数据，
 * CP 提供图鉴 API + web 页。
 */

import { readFile } from 'fs/promises';
import { join } from 'path';

/** 表情包资源目录（相对租户数据根；与 agent meme/storage.ts 对齐） */
export const MEME_ASSETS_DIR = 'meme-assets';

/** 表情包元数据（图鉴契约：话题/情绪/日期/模式/qcPass） */
export interface MemeMeta {
  id: string;
  topic: string;
  emotion: string;
  date: string;
  mode: 'abstract' | 'ip';
  file: string;
  qcPass: boolean;
  createdAt: number;
}

/** 资源目录绝对路径 */
export function memeAssetsDir(dataDir: string): string {
  return join(dataDir, MEME_ASSETS_DIR);
}

/** manifest 绝对路径 */
export function memeManifestPath(dataDir: string): string {
  return join(memeAssetsDir(dataDir), 'manifest.json');
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
