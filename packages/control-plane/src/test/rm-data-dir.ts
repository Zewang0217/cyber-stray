/**
 * 测试数据目录清理（带退避重试）
 *
 * 活跃/用量埋点（noteTenantActivity / recordUsage）是 fire-and-forget 写：
 * 请求返回后 mkdir + appendFile 仍在途，afterEach 的 rmSync 可能与之竞态
 * （写方在 rmdir 与 unlink 之间重建 activity 文件 → ENOTEMPTY）。先让事件
 * 循环空转等在途 IO，再删；仍撞上则短退避重试——重试只兜「清理与后台写
 * 的时序」，不掩盖断言失败（rmSync 最终失败仍上抛）。
 */

import { rmSync } from 'fs';

/** 等待 fire-and-forget 埋点写落地后删除测试数据目录 */
export async function rmDataDir(dir: string, attempts = 5): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5 * (i + 1)));
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (i === attempts - 1) throw error;
    }
  }
}
