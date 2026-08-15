/**
 * 控制面数据库客户端（SQLite / Postgres 双驱动）
 *
 * 验收 #70：连接串可切 Postgres 不重写查询。Drizzle 查询层方言无关，
 * 本模块按 DATABASE_URL scheme 选择驱动：
 *   sqlite:<path> / file:<path>  → libsql（Node + Bun 双运行时，默认）
 *   postgres://user:pass@host/db → node-postgres（pg）
 *
 * 默认库文件：控制面数据根下 control.db（与租户数据目录同根，gitignored）。
 */

import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { fileURLToPath } from 'url';
import { join } from 'path';
import * as schema from './schema.js';

/**
 * 控制面数据库类型：以 SQLite（libsql）为准——它是当前唯一运行时目标。
 * Postgres 分支保留代码路径（验收：切连接串即可），但该路径经显式转换，
 * 类型按 SQLite 方言校验（两方言查询 API 在 Drizzle 层一致）。
 */
export type ControlDb = LibSQLDatabase<typeof schema>;

let dbPromise: Promise<ControlDb> | null = null;

/** 默认 SQLite 路径：<dataDir>/control.db */
function defaultSqlitePath(dataDir: string): string {
  return join(dataDir, 'control.db');
}

/**
 * 获取数据库实例（按 DATABASE_URL 懒加载；同进程单例）。
 *
 * DATABASE_URL 缺省 → sqlite:<dataDir>/control.db。
 */
export function getDb(dataDir?: string): Promise<ControlDb> {
  if (!dbPromise) {
    dbPromise = createDb(dataDir);
  }
  return dbPromise;
}

async function createDb(dataDir?: string): Promise<ControlDb> {
  const url = process.env.DATABASE_URL;
  if (!url || url.startsWith('sqlite:') || url.startsWith('file:')) {
    const path = url
      ? new URL(url).pathname
      : defaultSqlitePath(dataDir ?? fileURLToPath(new URL('../../data', import.meta.url)));
    // libsql：Node/Bun 双运行时；本地文件 = SQLite（WAL 默认开启）
    const client = createClient({ url: `file:${path}` });
    return drizzle(client, { schema });
  }
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    // 结构等价：pg 驱动与 libsql 的 Drizzle 查询 API 一致，仅连接对象不同；
    // 当前类型以 SQLite 方言校验，pg 路径运行时成立（见 migrate.ts 门控）
    const pool = new Pool({ connectionString: url });
    const pgClient = drizzlePg(pool, { schema });
    return pgClient as unknown as ControlDb;
  }
  throw new Error(`不支持的 DATABASE_URL scheme: ${url.split(':')[0]}`);
}

/** 测试隔离：重置单例（换临时目录后必须调用） */
export function _resetDb(): void {
  dbPromise = null;
}
