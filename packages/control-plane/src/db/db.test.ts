/**
 * 控制面数据模型测试（S3）
 *
 * 覆盖：迁移可用、五表 CRUD、宠物调度字段（lastRunAt/boredom/energy/plan）、
 * 用户↔租户关系、账单/ secrets 占位表、连接串切换逻辑。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import {
  tenants,
  userTenants,
  pets,
  billing,
  tenantSecrets,
} from '../db/schema.js';

describe('控制面数据模型', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-db-'));
    _resetDb();
    await runMigrations(dataDir);
  });

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('迁移幂等：重复跑不报错（migrator 按版本表去重）', async () => {
    await expect(runMigrations(dataDir)).resolves.toBeUndefined();
  });

  it('租户 + 用户关系 CRUD', async () => {
    const db = await getDb(dataDir);
    await db.insert(tenants).values({ id: 't1', name: 'T1' }).run();
    await db
      .insert(userTenants)
      .values({ userId: 'u1', tenantId: 't1', role: 'owner' })
      .run();

    const t = await db.select().from(tenants).where(eq(tenants.id, 't1')).get();
    expect(t?.name).toBe('T1');

    const rel = await db
      .select()
      .from(userTenants)
      .where(eq(userTenants.userId, 'u1'))
      .get();
    expect(rel?.tenantId).toBe('t1');
    expect(rel?.role).toBe('owner');
  });

  it('宠物表含调度字段：lastRunAt/boredom/energy/plan', async () => {
    const db = await getDb(dataDir);
    await db.insert(tenants).values({ id: 't1', name: 'T1' }).run();
    await db
      .insert(pets)
      .values({
        id: 'p1',
        tenantId: 't1',
        name: '街溜子',
        lastRunAt: 1700000000000,
        boredom: 55,
        energy: 40,
        plan: 'pro',
      })
      .run();

    const pet = await db.select().from(pets).where(eq(pets.id, 'p1')).get();
    expect(pet).toMatchObject({
      tenantId: 't1',
      lastRunAt: 1700000000000,
      boredom: 55,
      energy: 40,
      plan: 'pro',
      status: 'active',
    });
    // 调度字段可更新（S5 前推依赖）
    await db
      .update(pets)
      .set({ lastRunAt: 1700000001000, boredom: 60, energy: 35 })
      .where(eq(pets.id, 'p1'))
      .run();
    const updated = await db.select().from(pets).where(eq(pets.id, 'p1')).get();
    expect(updated?.boredom).toBe(60);
    expect(updated?.lastRunAt).toBe(1700000001000);
  });

  it('宠物默认值：active/free/boredom30/energy80', async () => {
    const db = await getDb(dataDir);
    await db.insert(tenants).values({ id: 't1', name: 'T1' }).run();
    await db.insert(pets).values({ id: 'p1', tenantId: 't1', name: 'dog' }).run();
    const pet = await db.select().from(pets).where(eq(pets.id, 'p1')).get();
    expect(pet).toMatchObject({ status: 'active', plan: 'free', boredom: 30, energy: 80 });
  });

  it('级联删除：删租户连带宠物/关系/账单/secrets', async () => {
    const db = await getDb(dataDir);
    await db.insert(tenants).values({ id: 't1', name: 'T1' }).run();
    await db.insert(pets).values({ id: 'p1', tenantId: 't1', name: 'dog' }).run();
    await db
      .insert(userTenants)
      .values({ userId: 'u1', tenantId: 't1', role: 'owner' })
      .run();
    await db.insert(billing).values({ id: 'b1', tenantId: 't1', plan: 'free' }).run();
    await db.insert(tenantSecrets).values({ tenantId: 't1' }).run();

    await db.delete(tenants).where(eq(tenants.id, 't1')).run();

    expect(await db.select().from(pets).all()).toHaveLength(0);
    expect(await db.select().from(userTenants).all()).toHaveLength(0);
    expect(await db.select().from(billing).all()).toHaveLength(0);
    expect(await db.select().from(tenantSecrets).all()).toHaveLength(0);
  });

  it('账单/ secrets 占位表结构可用', async () => {
    const db = await getDb(dataDir);
    await db.insert(tenants).values({ id: 't1', name: 'T1' }).run();
    await db
      .insert(billing)
      .values({ id: 'b1', tenantId: 't1', plan: 'pro', status: 'paid', amountCents: 500, currency: 'CNY' })
      .run();
    await db
      .insert(tenantSecrets)
      .values({ tenantId: 't1', keyId: 'dek-1', encrypted: 'ciphertext' })
      .run();

    const bill = await db.select().from(billing).where(eq(billing.id, 'b1')).get();
    expect(bill?.amountCents).toBe(500);
    const secret = await db.select().from(tenantSecrets).where(eq(tenantSecrets.tenantId, 't1')).get();
    expect(secret?.keyId).toBe('dek-1');
  });
});
