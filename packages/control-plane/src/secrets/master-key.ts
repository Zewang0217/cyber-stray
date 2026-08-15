/**
 * master key 加载（S4 信封加密）
 *
 * 优先级：env CP_MASTER_KEY（64 hex = 32 字节）> dataDir/master.key。
 * 文件模式（dev）：首次自动生成 32 字节随机 hex，chmod 600；此后幂等复用。
 * 生产（NODE_ENV=production）：缺失即抛错（fail-fast，绝不自动生成落盘）。
 *
 * 一致性：env 与既有文件都存在但 hex 不同 → 抛错（静默切换会解不开全部
 * 租户 DEK；须人工删文件或对齐 env 后重启）。非法输入一律抛错（禁止兜底）。
 */

import { randomBytes } from 'crypto';
import { chmod, mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const MASTER_KEY_FILE = 'master.key';
const MASTER_KEY_HEX = /^[0-9a-f]{64}$/;

/** 加载 32 字节 master key（Buffer） */
export async function loadMasterKey(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Buffer> {
  const fromEnv = env.CP_MASTER_KEY;
  const file = join(dataDir, MASTER_KEY_FILE);

  if (fromEnv !== undefined) {
    if (!MASTER_KEY_HEX.test(fromEnv)) {
      throw new Error('CP_MASTER_KEY 必须是 64 位 hex（32 字节）');
    }
    // env 与既有文件不一致：静默切换会解不开全部租户 DEK，显式报错
    let fileHex: string | null = null;
    try {
      fileHex = (await readFile(file, 'utf8')).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (fileHex !== null && fileHex !== fromEnv) {
      throw new Error(
        `CP_MASTER_KEY 与 ${file} 不一致：请删除文件或对齐 env 后重启` +
          '（不一致会解不开既有租户 DEK）',
      );
    }
    return Buffer.from(fromEnv, 'hex');
  }

  // 无 env：文件模式
  try {
    const hex = (await readFile(file, 'utf8')).trim();
    if (!MASTER_KEY_HEX.test(hex)) {
      throw new Error(`master.key 内容非法（${file}）：须为 64 位 hex`);
    }
    return Buffer.from(hex, 'hex');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  // 文件不存在
  if (env.NODE_ENV === 'production') {
    throw new Error(
      '生产环境必须设置 CP_MASTER_KEY（64 位 hex）；缺失时禁止自动生成落盘',
    );
  }
  await mkdir(dataDir, { recursive: true });
  const hex = randomBytes(32).toString('hex');
  await writeFile(file, `${hex}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  return Buffer.from(hex, 'hex');
}
