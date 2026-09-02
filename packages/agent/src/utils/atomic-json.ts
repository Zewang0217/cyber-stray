/**
 * JSON 原子写（temp + rename）
 *
 * 全包唯一实现：interest-graph / user-profile / curiosity-interests / reflection-scheduler
 * 复用它，禁止再复制（祖先目录用 path.dirname() 推导——substring + lastIndexOf('/')
 * 在 win32 下 path.join 产出反斜杠路径时会得到 -1 → 目录退化到 '.'，新建子目录失败）。
 */
import { dirname } from 'path';
import { writeFile, rename, mkdir } from 'fs/promises';

/** 原子写 JSON（自动建父目录；tmp 名唯一避免并发冲突） */
export async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = JSON.stringify(data, null, 2);
  await writeFile(tmp, payload, 'utf-8');
  await rename(tmp, path);
}