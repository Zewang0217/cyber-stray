/**
 * 数据库迁移（启动时执行）
 *
 * SQLite 用 libsql migrator。migrationsFolder 指向 drizzle-kit generate 产物
 * （包根 drizzle/，dialect=sqlite 生成）。幂等：migrator 按版本表去重。
 *
 * Postgres：查询层可经 client.ts 切换（验收 #70），但迁移 SQL 是 SQLite 方言
 * （反引号标识符），不能直接喂 pg migrator——切连接串前必须先用
 * `drizzle-kit generate --dialect=postgresql` 重生成迁移，否则启动抛错（不兜底）。
 */

import { migrate as migrateSqlite } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'url';
import { getDb, type ControlDb } from './client.js';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** 运行时判别当前驱动：libsql client 暴露 execute；pg Pool 暴露 query */
function isSqliteDb(db: ControlDb): boolean {
  if (!('$client' in db)) return false;
  const client = db.$client;
  return typeof client === 'object' && client !== null && 'execute' in client;
}

/** 应用所有待执行迁移。控制面启动时调用。 */
export async function runMigrations(dataDir?: string): Promise<void> {
  const db = await getDb(dataDir);
  if (!isSqliteDb(db)) {
    throw new Error(
      'DATABASE_URL 指向 Postgres，但迁移产物是 SQLite 方言（drizzle/ 由 dialect:sqlite 生成）。' +
        '切换前请先运行 drizzle-kit generate --dialect=postgresql 重新生成迁移。',
    );
  }
  await migrateSqlite(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
