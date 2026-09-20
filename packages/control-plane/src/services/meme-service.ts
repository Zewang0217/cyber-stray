/**
 * MemeService（应用层）——表情包图鉴
 *
 * 收录列表（只展示 qcPass=true——质检不过不进图鉴，收录标记由 agent
 * 生成管线写入 manifest，此处过滤兜底）、成品图读取、删除
 * （先删 manifest 条目再删磁盘，失败不影响索引一致性）。
 * manifest/磁盘操作复用 meme/storage 单一实现。
 */

import { mkdir, rm, writeFile, rename } from 'fs/promises';
import { join } from 'path';
import type { ControlPlaneConfig } from '../config.js';
import { MEME_ASSETS_DIR, loadManifest, memeAssetsDir } from '../meme/storage.js';
import { readTenantFile } from '../infra/tenant-data-reader.js';
import { tenantDataDir } from '../tenant.js';

export interface MemeServiceDeps {
  config: Pick<ControlPlaneConfig, 'dataDir'>;
}

export interface MemeRow {
  id: string;
  topic: string;
  emotion: string;
  date: string;
  mode: string;
  createdAt: number;
}

/** 表情包 API 视图（附图片 URL） */
function toMemeView(meme: MemeRow) {
  return {
    id: meme.id,
    topic: meme.topic,
    emotion: meme.emotion,
    date: meme.date,
    mode: meme.mode,
    createdAt: meme.createdAt,
    imageUrl: `/api/meme/${meme.id}/image.png`,
  };
}

export function createMemeService({ config }: MemeServiceDeps) {
  /** 收录表情包列表（时间倒序，只 qcPass） */
  async function listPass(tenantId: string) {
    const manifest = await loadManifest(tenantDataDir(config.dataDir, tenantId));
    return manifest
      .filter((m) => m.qcPass)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(toMemeView);
  }

  /** 成品图字节；id 不在 manifest / 未过质检 / 文件缺失 → null（404 语义） */
  async function getImage(tenantId: string, id: string): Promise<Buffer | null> {
    const manifest = await loadManifest(tenantDataDir(config.dataDir, tenantId));
    // 校验 id 在 manifest 中且过质检（防直接猜路径读未收录/他人文件）
    const entry = manifest.find((m) => m.id === id && m.qcPass);
    if (!entry) return null;
    return readTenantFile(config.dataDir, tenantId, join(MEME_ASSETS_DIR, entry.file));
  }

  /** 删除一张（先删 manifest 条目（原子），再删磁盘文件）；不存在 → null */
  async function remove(tenantId: string, id: string) {
    const dir = tenantDataDir(config.dataDir, tenantId);
    const manifest = await loadManifest(dir);
    const entry = manifest.find((m) => m.id === id);
    if (!entry) return null;

    // 重写 manifest（去掉指定 id；原子写 tmp+rename）
    const assetsDir = memeAssetsDir(dir);
    const manifestPath = join(assetsDir, 'manifest.json');
    const remaining = manifest.filter((m) => m.id !== id);
    await mkdir(assetsDir, { recursive: true });
    const tmp = `${manifestPath}.tmp`;
    await writeFile(tmp, JSON.stringify(remaining, null, 2), 'utf-8');
    await rename(tmp, manifestPath);

    await rm(join(assetsDir, entry.file), { force: true });
    return { id };
  }

  return { listPass, getImage, remove };
}

export type MemeService = ReturnType<typeof createMemeService>;
