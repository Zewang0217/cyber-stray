/**
 * PetGenService 提交串行化测试——同租户并发提交竞态回归锚
 *
 * 契约：hasInFlightTask（SELECT）与 insertTask（INSERT）之间的 await 窗口
 * 内，两个并发提交不得同时插入（nextDueTask 只推进「租户恰 1 个在飞」的
 * 任务，双插入 = 队列永久互卡且无取消端点）。submitTask（改造屋）与
 * submitAdoptTask（领养自动建任务）两入口混发同样受串行化保护。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant } from '../infra/tenant.js';
import { petGenTasks } from '../db/schema.js';
import { buildAdoptAppearanceSpec, createPetGenService } from './petgen-service.js';

describe('petgen-service 提交串行化（同租户并发竞态）', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-petgen-svc-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
  });

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function inFlightCount(tenantId: string): Promise<number> {
    const db = await getDb(dataDir);
    const rows = await db
      .select()
      .from(petGenTasks)
      .where(eq(petGenTasks.tenantId, tenantId))
      .all();
    return rows.length;
  }

  it('并发领养建任务 × 2：恰好一个成功、一个 busy（旧实现双插入互卡）', async () => {
    const service = createPetGenService({ principalSub: 'alice', config: { dataDir, petGenMonthlyQuota: 2 } });
    const spec = buildAdoptAppearanceSpec({ name: '煤球', interests: ['ai'], personality: 'curious' });
    const [a, b] = await Promise.all([
      service.submitAdoptTask('alice', spec),
      service.submitAdoptTask('alice', spec),
    ]);
    const oks = [a, b].filter((r) => r.ok);
    expect(oks).toHaveLength(1);
    expect(await inFlightCount('alice')).toBe(1);
  });

  it('串行化不误伤不同租户：两租户并发提交各自成功', async () => {
    const service = createPetGenService({ principalSub: 'alice', config: { dataDir, petGenMonthlyQuota: 2 } });
    const spec = buildAdoptAppearanceSpec({ name: '煤球', interests: ['ai'], personality: 'curious' });
    await getOrCreateTenant(dataDir, 'bob');
    const [a, b] = await Promise.all([
      service.submitAdoptTask('alice', spec),
      service.submitAdoptTask('bob', spec),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});
