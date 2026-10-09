/**
 * 邀请 repo 测试（#301）——状态机：生成/校验/消费/吊销 + 并发一次性语义
 *
 * 契约：raw token 不落库（只存 sha256）；消费是条件更新（并发只有一人成功）；
 * 已吊销不可再次吊销；列表脱敏 tokenHash。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { sql } from 'drizzle-orm';
import { inviteRedemptions } from '../db/schema.js';
import { runMigrations } from '../db/migrate.js';
import { getDb, _resetDb } from '../db/client.js';
import {
  createInvite,
  listInvites,
  revokeInvite,
  validateInvite,
  consumeInvite,
  expandInvite,
} from './invites-repo.js';

let dataDir: string;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'cp-invites-'));
  _resetDb();
  await runMigrations(dataDir);
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  _resetDb();
});

describe('invites-repo 生命周期', () => {
  it('生成 → 校验有效 → 消费 → 再校验无效（一次性）', async () => {
    const created = await createInvite(dataDir, { createdBy: 'admin-1', label: '给老王' });
    expect(created.token).toMatch(/^[0-9a-f]{32}$/);
    expect(created.label).toBe('给老王');

    const valid = await validateInvite(dataDir, created.token);
    expect(valid?.id).toBe(created.id);

    expect(await consumeInvite(dataDir, created.id, 'tenant-w')).toBe(true);

    expect(await validateInvite(dataDir, created.token)).toBeNull();
    // 再消费（并发第二人）失败
    expect(await consumeInvite(dataDir, created.id, 'tenant-x')).toBe(false);
  });

  it('raw token 不落库：列表无 tokenHash', async () => {
    const created = await createInvite(dataDir, { createdBy: 'admin-1' });
    const all = await listInvites(dataDir);
    expect(all).toHaveLength(1);
    expect(all[0]).not.toHaveProperty('tokenHash');
    expect(Object.keys(all[0]!)).not.toContain('tokenHash');
    expect(created.token).not.toBe(all[0]!.id);
  });

  it('吊销后不可用；重复吊销返回 false', async () => {
    const created = await createInvite(dataDir, { createdBy: 'admin-1' });
    expect(await revokeInvite(dataDir, created.id)).toBe(true);
    expect(await validateInvite(dataDir, created.token)).toBeNull();
    expect(await revokeInvite(dataDir, created.id)).toBe(false);
  });

  it('已用满的邀请仍可吊销，不能通过追加恢复', async () => {
    const created = await createInvite(dataDir, { createdBy: 'admin-1' });
    await consumeInvite(dataDir, created.id, 'tenant-w');
    expect(await revokeInvite(dataDir, created.id)).toBe(true);
    expect(await expandInvite(dataDir, created.id, 2)).toBeNull();
  });

  it('假 token 校验返回 null（不抛）', async () => {
    expect(await validateInvite(dataDir, 'deadbeef')).toBeNull();
  });
  it('同一链接支持多人，用满后追加额度不改变 token', async () => {
    const invite = await createInvite(dataDir, { createdBy: 'admin', maxUses: 2 });
    expect(await consumeInvite(dataDir, invite.id, 'a')).toBe(true);
    expect(await validateInvite(dataDir, invite.token)).not.toBeNull();
    expect(await consumeInvite(dataDir, invite.id, 'b')).toBe(true);
    expect(await validateInvite(dataDir, invite.token)).toBeNull();
    expect((await expandInvite(dataDir, invite.id, 3))?.maxUses).toBe(5);
    expect(await validateInvite(dataDir, invite.token)).not.toBeNull();
    expect(await consumeInvite(dataDir, invite.id, 'c')).toBe(true);
    expect((await listInvites(dataDir))[0]?.usedCount).toBe(3);
  });

  it('重复用户不能消费同一条或另一条链接，也不会扣减名额', async () => {
    const one = await createInvite(dataDir, { createdBy: 'admin', maxUses: 3 });
    const two = await createInvite(dataDir, { createdBy: 'admin', maxUses: 3 });
    expect(await consumeInvite(dataDir, one.id, 'same')).toBe(true);
    expect(await consumeInvite(dataDir, one.id, 'same')).toBe(false);
    expect(await consumeInvite(dataDir, two.id, 'same')).toBe(false);
    const rows = await listInvites(dataDir);
    expect(rows.find(r => r.id === one.id)?.usedCount).toBe(1);
    expect(rows.find(r => r.id === two.id)?.usedCount).toBe(0);
  });

  it('并发消费不会超出名额；并发追加不会丢失增量', async () => {
    const invite = await createInvite(dataDir, { createdBy: 'admin', maxUses: 3 });
    const results = await Promise.all(Array.from({ length: 12 }, (_, n) => consumeInvite(dataDir, invite.id, `user-${n}`)));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect((await listInvites(dataDir))[0]?.usedCount).toBe(3);
    await Promise.all([expandInvite(dataDir, invite.id, 2), expandInvite(dataDir, invite.id, 4)]);
    expect((await listInvites(dataDir))[0]?.maxUses).toBe(9);
  });

  it('旧库迁移保留已用/吊销状态，并容纳历史重复归因，旧码可以追加复用', async () => {
    const legacyRoot = join(dataDir, 'legacy');
    const folder = join(dataDir, 'old-migrations');
    await mkdir(legacyRoot);
    await cp(fileURLToPath(new URL('../../drizzle', import.meta.url)), folder, { recursive: true });
    const journalPath = join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: { idx: number }[] };
    journal.entries = journal.entries.filter(entry => entry.idx < 20);
    await writeFile(journalPath, JSON.stringify(journal));
    _resetDb();
    const db = await getDb(legacyRoot);
    await migrate(db, { migrationsFolder: folder });
    await db.run(sql`INSERT INTO invites (id, token_hash, created_by, created_at, consumed_at, consumed_tenant_id)
      VALUES ('old-first', 'hash-one', 'admin', 1, 10, 'legacy-user'), ('old-repeat', 'hash-two', 'admin', 2, 20, 'legacy-user')`);
    await db.run(sql`INSERT INTO invites (id, token_hash, created_by, created_at, revoked_at)
      VALUES ('old-open', 'hash-three', 'admin', 3, NULL), ('old-revoked', 'hash-four', 'admin', 4, 30)`);
    await runMigrations(legacyRoot);
    const rows = await listInvites(legacyRoot);
    expect(rows.find(row => row.id === 'old-first')).toMatchObject({ maxUses: 1, usedCount: 1, consumedTenantId: 'legacy-user' });
    expect(rows.find(row => row.id === 'old-open')).toMatchObject({ maxUses: 1, usedCount: 0 });
    expect(await db.select().from(inviteRedemptions)).toHaveLength(1);
    expect(await expandInvite(legacyRoot, 'old-revoked', 2)).toBeNull();
    expect((await expandInvite(legacyRoot, 'old-first', 2))?.maxUses).toBe(3);
    expect(await consumeInvite(legacyRoot, 'old-first', 'next-user')).toBe(true);
  });

});
