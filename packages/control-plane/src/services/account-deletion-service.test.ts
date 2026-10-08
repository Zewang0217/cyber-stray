/**
 * 账户注销服务测试：软删语义（审计字段落库 + 宠物停派）、管理员账号保护、
 * 自助确认口径（宠物名 / 「注销」）、批量逐项独立成败。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant } from '../infra/tenant.js';
import { admins, pets, tenants } from '../db/schema.js';
import { createAccountDeletionService, expectedSelfConfirm } from './account-deletion-service.js';

describe('AccountDeletionService（软删）', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-acct-del-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    await getOrCreateTenant(dataDir, 'bob');
    const db = await getDb(dataDir);
    await db.insert(pets).values({
      id: 'pet-a', tenantId: 'alice', name: '小溜', status: 'active',
    }).run();
  });

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function service() {
    return createAccountDeletionService({ config: { dataDir, adminSubs: ['env-admin'] } });
  }

  it('注销：审计字段落库 + 宠物置 paused（停止探索）', async () => {
    const outcome = await service().deleteAccount({
      tenantId: 'alice', mode: 'admin', reason: '清理测试账号', operatorSub: 'op-1',
    });
    expect(outcome.ok).toBe(true);
    const db = await getDb(dataDir);
    const t = await db.select().from(tenants).where(eq(tenants.id, 'alice')).get();
    expect(t?.deletedAt).not.toBeNull();
    expect(t?.deletionMode).toBe('admin');
    expect(t?.deletionReason).toBe('清理测试账号');
    expect(t?.deletedBy).toBe('op-1');
    const pet = await db.select().from(pets).where(eq(pets.tenantId, 'alice')).get();
    expect(pet?.status).toBe('paused');
  });

  it('重复注销 → 400 已注销；租户不存在 → 404', async () => {
    const first = await service().deleteAccount({ tenantId: 'alice', mode: 'admin', reason: 'x', operatorSub: 'op-1' });
    expect(first.ok).toBe(true);
    const second = await service().deleteAccount({ tenantId: 'alice', mode: 'admin', reason: 'x', operatorSub: 'op-1' });
    expect(second).toMatchObject({ ok: false, status: 400 });
    const missing = await service().deleteAccount({ tenantId: 'ghost', mode: 'admin', reason: 'x', operatorSub: 'op-1' });
    expect(missing).toMatchObject({ ok: false, status: 404 });
  });

  it('管理员账号不可注销（env 白名单与 admins 表两条来源）', async () => {
    await getOrCreateTenant(dataDir, 'env-admin');
    const db = await getDb(dataDir);
    await db.insert(admins).values({ sub: 'bob', grantedBy: 'op-1' }).run();

    const viaEnv = await service().deleteAccount({ tenantId: 'env-admin', mode: 'admin', reason: 'x', operatorSub: 'op-1' });
    expect(viaEnv).toMatchObject({ ok: false, status: 400 });
    const viaTable = await service().deleteAccount({ tenantId: 'bob', mode: 'admin', reason: 'x', operatorSub: 'op-1' });
    expect(viaTable).toMatchObject({ ok: false, status: 400 });
    // 被拒绝后行未变动
    const t = await db.select().from(tenants).where(eq(tenants.id, 'bob')).get();
    expect(t?.deletedAt).toBeNull();
  });

  it('自助注销：宠物名匹配才放行；reason 为空白时存 null', async () => {
    const wrong = await service().deleteSelf({ tenantId: 'alice', sub: 'alice', confirmPetName: '阿黄' });
    expect(wrong).toMatchObject({ ok: false, status: 400 });

    const ok = await service().deleteSelf({ tenantId: 'alice', sub: 'alice', confirmPetName: '小溜', reason: '  ' });
    expect(ok.ok).toBe(true);
    const db = await getDb(dataDir);
    const t = await db.select().from(tenants).where(eq(tenants.id, 'alice')).get();
    expect(t?.deletionMode).toBe('self');
    expect(t?.deletionReason).toBeNull();
    expect(t?.deletedBy).toBe('alice');
  });

  it('未领养租户的自助确认口径：输入「注销」二字', async () => {
    const wrong = await service().deleteSelf({ tenantId: 'bob', sub: 'bob', confirmPetName: '小溜' });
    expect(wrong).toMatchObject({ ok: false, status: 400 });
    const ok = await service().deleteSelf({ tenantId: 'bob', sub: 'bob', confirmPetName: '注销' });
    expect(ok.ok).toBe(true);
    expect(expectedSelfConfirm('小溜')).toBe('小溜');
    expect(expectedSelfConfirm(null)).toBe('注销');
  });

  it('批量注销：逐项独立成败，失败项不影响其余', async () => {
    const results = await service().batchDelete({
      tenantIds: ['alice', 'ghost', 'bob'], reason: '批量清理', operatorSub: 'op-1',
    });
    expect(results).toEqual([
      { tenantId: 'alice', ok: true },
      expect.objectContaining({ tenantId: 'ghost', ok: false }),
      { tenantId: 'bob', ok: true },
    ]);
    const db = await getDb(dataDir);
    // alice 有宠物行：确认停派（bob 无宠物，删除即完成）
    expect((await db.select().from(pets).where(eq(pets.tenantId, 'alice')).get())?.status).toBe('paused');
    expect((await db.select().from(tenants).where(eq(tenants.id, 'bob')).get())?.deletedAt).not.toBeNull();
  });
});
