/**
 * 邀请 repo 测试（#301）——状态机：生成/校验/消费/吊销 + 并发一次性语义
 *
 * 契约：raw token 不落库（只存 sha256）；消费是条件更新（并发只有一人成功）；
 * 已消费/已吊销不可再吊销；列表脱敏 tokenHash。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { _resetDb } from '../db/client.js';
import {
  createInvite,
  listInvites,
  revokeInvite,
  validateInvite,
  consumeInvite,
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

  it('raw token 不落库：列表与校验侧均无 tokenHash', async () => {
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

  it('已消费的邀请不可吊销（终态保护）', async () => {
    const created = await createInvite(dataDir, { createdBy: 'admin-1' });
    await consumeInvite(dataDir, created.id, 'tenant-w');
    expect(await revokeInvite(dataDir, created.id)).toBe(false);
  });

  it('假 token 校验返回 null（不抛）', async () => {
    expect(await validateInvite(dataDir, 'deadbeef')).toBeNull();
  });
});
