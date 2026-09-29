/**
 * E2E 本地引导（一次性调试工具）：建租户 + 用户关系 + 签发 session cookie。
 *
 * 绕过 Casdoor 登录跳（既有基建，不在本功能测试面）——用与 CP 相同的
 * CP_SESSION_SECRET 签出合法 JWT，浏览器以 JS 写入 cs_session（无既有
 * httpOnly cookie 时可设，请求照常携带）。
 *
 * 用法：cd packages/control-plane && CP_DATA_DIR=<dir> bun run scripts/e2e-bootstrap.ts
 * 输出：cookie 赋值 JS 一行（直接在浏览器 console 执行）
 */

import { mkdirSync } from 'node:fs';
import { runMigrations } from '../src/db/migrate.js';
import { getDb } from '../src/db/client.js';
import { getOrCreateTenant } from '../src/infra/tenant.js';
import { userTenants } from '../src/db/schema.js';
import { signSession, SESSION_COOKIE } from '../src/auth/session.js';

const dataDir = process.env.CP_DATA_DIR;
if (!dataDir) throw new Error('缺 CP_DATA_DIR');
const secret = process.env.CP_SESSION_SECRET;
if (!secret) throw new Error('缺 CP_SESSION_SECRET');

const SUB = 'e2e-dev';
mkdirSync(dataDir, { recursive: true });
await runMigrations(dataDir);
await getOrCreateTenant(dataDir, SUB);
const db = await getDb(dataDir);
await db
  .insert(userTenants)
  .values({ userId: SUB, tenantId: SUB, role: 'owner' })
  .onConflictDoNothing()
  .run();
const token = await signSession({ sub: SUB, tenantId: SUB }, secret);
console.log(`document.cookie='${SESSION_COOKIE}=${token}; path=/'; location.reload();`);
