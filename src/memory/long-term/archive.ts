/**
 * 软删除归档模块（MEM-02 / D-01）
 *
 * 将被合并/清理的记忆文件通过 `rename` 原子移到 `data/memory/.archive/<type>/`
 * 子目录下（非破坏性遗忘），替代旧的直接 `rm`。归档文件可恢复，符合"遗忘是特性
 * 不是 bug，但不可逆数据丢失要避免"。
 *
 * 设计要点：
 * - **同文件系统原子 move**：`rename` 在 POSIX 下是原子操作；临时目录与归档目录
 *   同在 basePath 下保证不跨文件系统（退化为 copy+delete）。
 * - **路径防遍历**：目标文件名过 `toSafeFilename`（types.ts:89），阻止 `../` 与
 *   路径分隔符（ASVS V12 / RESEARCH T-01-06）。
 * - **`.archive/` 不被重扫**：归档落在 `.archive/<MEMORY_TYPE_PATHS[type]>/` 下，
 *   `MEMORY_TYPE_PATHS` 不含 `.archive`，getRecentMemories/rebuildIndexFromMarkdown
 *   只扫显式四目录（Pitfall 6 / T-01-07）。
 * - **D-09 显式报错**：sourcePath 不存在直接抛 Error（不静默跳过，符合 CLAUDE.md
 *   禁止兜底红线）。
 */

import { rename, mkdir, stat } from 'fs/promises';
import { join, basename } from 'path';
import { consola } from '../../logger.js';
import { MEMORY_TYPE_PATHS, toSafeFilename, type MemoryType } from './types.js';

const logger = consola.withTag('MemoryArchive');

/**
 * 将源文件软删除（move）到 `.archive/<type>/` 目录下
 *
 * @param sourcePath 源 Markdown 文件绝对/相对路径
 * @param type       记忆类型（决定归档到哪个子目录）
 * @param basePath   记忆根目录（如 `data/memory`），归档目录 `.archive/` 落在此下
 * @throws Error 当 sourcePath 不存在（D-09 不静默跳过）或 rename 失败
 */
export async function archiveFile(
  sourcePath: string,
  type: MemoryType,
  basePath: string,
): Promise<void> {
  // D-09：sourcePath 不存在直接抛错（不静默跳过）
  const sourceStat = await stat(sourcePath).catch((error) => {
    throw new Error(`archiveFile 源文件不存在: ${sourcePath}`, { cause: error });
  });
  if (!sourceStat.isFile()) {
    throw new Error(`archiveFile 源不是文件: ${sourcePath}`);
  }

  const archiveDir = join(basePath, '.archive', MEMORY_TYPE_PATHS[type]);
  await mkdir(archiveDir, { recursive: true });

  // basename 过 toSafeFilename 防路径遍历（如 `../../etc/passwd` → 合法文件名）
  const destFilename = `${toSafeFilename(basename(sourcePath))}.md`;
  const destPath = join(archiveDir, destFilename);

  await rename(sourcePath, destPath);
  logger.debug('记忆已软删除到归档', { sourcePath, destPath, type });
}
