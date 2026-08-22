/**
 * pets 路由测试（S7，#74）
 *
 * 契约：
 * - GET /api/pets：鉴权；返回当前租户宠物列表（空数组 = 未领养）
 * - POST /api/pets/adopt：鉴权；起名 + 初始兴趣（默认给，可改）；
 *   建 pets 行 + 数据目录 + interests.json 种子（与 agent InterestGraph
 *   schema 兼容：version 1 / weight 0.5 / source 'default'）
 * - 幂等：已有宠物 → 409（返回现有，不重复建）
 * - 种子不覆盖：interests.json 已存在（租户已游荡）→ 不写，只建宠物行
 * - 租户隔离：A 的 adopt 不影响 B 的列表
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { pets, tenants } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getOrCreateTenant } from '../tenant.js';
import { signSession, SESSION_COOKIE } from '../session.js';
import { getPersonality } from '@cyber-stray/shared';
import { createPetsRoutes } from './pets.js';

const SECRET = 'x'.repeat(40);

describe('pets 路由（领养）', () => {
  let dataDir: string;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-pets-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    await getOrCreateTenant(dataDir, 'bob');
    app = new Hono();
    const config = { dataDir, sessionSecret: SECRET } as Parameters<
      typeof createPetsRoutes
    >[0]['config'];
    app.route('/api', createPetsRoutes({ config }));
  });

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function authed(
    url: string,
    init: RequestInit = {},
    claims = { sub: 'alice', tenantId: 'alice' },
  ): Promise<Request> {
    const token = await signSession(claims, SECRET);
    const headers = new Headers(init.headers);
    headers.set('cookie', `${SESSION_COOKIE}=${token}`);
    headers.set('content-type', 'application/json');
    return new Request(url, { ...init, headers });
  }

  it('未登录：GET/POST 均 401', async () => {
    expect((await app.request('/api/pets')).status).toBe(401);
    expect(
      (await app.request('/api/pets/adopt', { method: 'POST' })).status,
    ).toBe(401);
  });

  it('GET /api/pets：未领养返回空数组', async () => {
    const res = await app.request(await authed('http://x/api/pets'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it('adopt：建宠物行 + interests.json 种子', async () => {
    const res = await app.request(
      await authed('http://x/api/pets/adopt', {
        method: 'POST',
        body: JSON.stringify({ name: '小溜', interests: ['AI', '机器人'] }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { name: string; tenantId: string; status: string; personality: string };
    };
    expect(body.data.name).toBe('小溜');
    expect(body.data.tenantId).toBe('alice');
    expect(body.data.status).toBe('active');
    // #90：认领时可选性格；未传默认 curious
    expect(body.data.personality).toBe('curious');
    // S14：套餐在账号层（tenants.plan），宠物行不再暴露 plan 死列
    expect('plan' in body.data).toBe(false);
    const db2 = await getDb(dataDir);
    const tenant = await db2.select().from(tenants).where(eq(tenants.id, 'alice')).get();
    expect(tenant?.plan).toBe('free');

    // 种子落盘：与 agent InterestGraphData schema 兼容
    const seedPath = join(dataDir, 'tenants', 'alice', 'interests.json');
    expect(existsSync(seedPath)).toBe(true);
    const seed = JSON.parse(readFileSync(seedPath, 'utf-8')) as {
      version: number;
      nodes: Array<{ id: string; weight: number; source: string }>;
    };
    expect(seed.version).toBe(1);
    expect(seed.nodes.map((n) => n.id)).toEqual(['AI', '机器人']);
    expect(seed.nodes.every((n) => n.weight === 0.5 && n.source === 'default')).toBe(true);
    // GET /api/pets 现在返回 1 只；pets 表恰好 1 行
    const list = await app.request(await authed('http://x/api/pets'));
    const listBody = (await list.json()) as { data: unknown[] };
    expect(listBody.data).toHaveLength(1);
    const db = await getDb(dataDir);
    expect((await db.select().from(pets).all()).length).toBe(1);
  });

  it('adopt 传 personality=lazy：落库并返回；非法值 400', async () => {
    const res = await app.request(
      await authed('http://x/api/pets/adopt', {
        method: 'POST',
        body: JSON.stringify({ name: '小懒', personality: 'lazy' }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { personality: string } };
    expect(body.data.personality).toBe('lazy');

    const bad = await app.request(
      await authed('http://x/api/pets/adopt', {
        method: 'POST',
        body: JSON.stringify({ name: '坏蛋', personality: 'angry' }),
      }),
    );
    expect(bad.status).toBe(400);
  });

  it('adopt 无 interests：默认种子（科技/AI/互联网）', async () => {
    const res = await app.request(
      await authed('http://x/api/pets/adopt', {
        method: 'POST',
        body: JSON.stringify({ name: '阿溜' }),
      }),
    );
    expect(res.status).toBe(201);
    const seed = JSON.parse(
      readFileSync(join(dataDir, 'tenants', 'alice', 'interests.json'), 'utf-8'),
    ) as { nodes: Array<{ id: string }> };
    expect(seed.nodes.map((n) => n.id)).toEqual(['科技', 'AI', '互联网']);
  });

  it('adopt 幂等冲突：已有宠物 → 409 返回现有', async () => {
    await app.request(
      await authed('http://x/api/pets/adopt', {
        method: 'POST',
        body: JSON.stringify({ name: '小溜' }),
      }),
    );
    const res = await app.request(
      await authed('http://x/api/pets/adopt', {
        method: 'POST',
        body: JSON.stringify({ name: '另一只' }),
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { data: { name: string } };
    expect(body.data.name).toBe('小溜'); // 返回现有，不重复建

    const db = await getDb(dataDir);
    const { pets } = await import('../db/schema.js');
    expect((await db.select().from(pets).all()).length).toBe(1);
  });

  it('种子不覆盖：interests.json 已存在 → 不写只建宠物行', async () => {
    const seedPath = join(dataDir, 'tenants', 'alice', 'interests.json');
    writeFileSync(
      seedPath,
      JSON.stringify({ version: 1, lastUpdated: '2026-08-01T00:00:00Z', nodes: [] }),
    );
    const res = await app.request(
      await authed('http://x/api/pets/adopt', {
        method: 'POST',
        body: JSON.stringify({ name: '小溜', interests: ['不该写入'] }),
      }),
    );
    expect(res.status).toBe(201);
    // 原文件未被覆盖（lastUpdated 保持原值）
    const seed = JSON.parse(readFileSync(seedPath, 'utf-8')) as {
      lastUpdated: string;
      nodes: unknown[];
    };
    expect(seed.lastUpdated).toBe('2026-08-01T00:00:00Z');
    expect(seed.nodes).toHaveLength(0);
  });

  it('参数校验：缺 name / 空 interests 项 → 400', async () => {
    const noName = await app.request(
      await authed('http://x/api/pets/adopt', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
    expect(noName.status).toBe(400);

    const emptyInterest = await app.request(
      await authed('http://x/api/pets/adopt', {
        method: 'POST',
        body: JSON.stringify({ name: '小溜', interests: [''] }),
      }),
    );
    expect(emptyInterest.status).toBe(400);
  });

  it('租户隔离：alice adopt 后 bob 列表仍空', async () => {
    await app.request(
      await authed('http://x/api/pets/adopt', {
        method: 'POST',
        body: JSON.stringify({ name: '小溜' }),
      }),
    );
    const bobList = await app.request(
      await authed('http://x/api/pets', {}, { sub: 'bob', tenantId: 'bob' }),
    );
    const body = (await bobList.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(0);
  });

  describe('作息（#91）：PUT/DELETE /api/pets/sleep-schedule', () => {
    async function seedPet(tenantId: string) {
      const db = await getDb(dataDir);
      await db
        .insert(pets)
        .values({
          id: `pet-${tenantId}`,
          tenantId,
          name: '小溜',
          status: 'active',
          lastRunAt: null,
          cooldownUntil: null,
          boredom: 30,
          energy: 80,
        })
        .run();
    }

    it('未登录：PUT/DELETE 均 401', async () => {
      expect(
        (await app.request('/api/pets/sleep-schedule', { method: 'PUT' })).status,
      ).toBe(401);
      expect(
        (await app.request('/api/pets/sleep-schedule', { method: 'DELETE' })).status,
      ).toBe(401);
    });

    it('未领养 → 409', async () => {
      const res = await app.request(
        await authed('http://x/api/pets/sleep-schedule', {
          method: 'PUT',
          body: JSON.stringify({ startHour: 22, endHour: 7 }),
        }),
      );
      expect(res.status).toBe(409);
    });

    it('PUT 设置作息（跨午夜合法），GET /api/pets 透出字段', async () => {
      await seedPet('alice');
      const res = await app.request(
        await authed('http://x/api/pets/sleep-schedule', {
          method: 'PUT',
          body: JSON.stringify({ startHour: 22, endHour: 7 }),
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { startHour: number; endHour: number } };
      expect(body.success).toBe(true);
      expect(body.data).toEqual({ startHour: 22, endHour: 7 });

      const db = await getDb(dataDir);
      const pet = await db.select().from(pets).where(eq(pets.tenantId, 'alice')).get();
      expect(pet?.sleepStart).toBe(22);
      expect(pet?.sleepEnd).toBe(7);

      // GET /api/pets 透出作息字段（前端设置页/展示用）
      const list = await app.request(await authed('http://x/api/pets'));
      const listBody = (await list.json()) as {
        data: Array<{ sleepStart: number | null; sleepEnd: number | null }>;
      };
      expect(listBody.data[0]?.sleepStart).toBe(22);
      expect(listBody.data[0]?.sleepEnd).toBe(7);
    });

    it('非法小时 / start==end / 非 JSON → 400', async () => {
      await seedPet('alice');
      const bad = async (body: unknown) =>
        app.request(
          await authed('http://x/api/pets/sleep-schedule', {
            method: 'PUT',
            body: typeof body === 'string' ? body : JSON.stringify(body),
          }),
        );

      expect((await bad({ startHour: 24, endHour: 7 })).status).toBe(400);
      expect((await bad({ startHour: 22, endHour: -1 })).status).toBe(400);
      expect((await bad({ startHour: 22.5, endHour: 7 })).status).toBe(400);
      expect((await bad({ startHour: 9, endHour: 9 })).status).toBe(400); // 空窗口
      expect((await bad('not json')).status).toBe(400);
    });

    it('DELETE 清除作息（回永不睡眠，与现状一致）', async () => {
      await seedPet('alice');
      const db = await getDb(dataDir);
      await db
        .update(pets)
        .set({ sleepStart: 22, sleepEnd: 7 })
        .where(eq(pets.tenantId, 'alice'))
        .run();

      const res = await app.request(
        await authed('http://x/api/pets/sleep-schedule', { method: 'DELETE' }),
      );
      expect(res.status).toBe(200);
      const pet = await db.select().from(pets).where(eq(pets.tenantId, 'alice')).get();
      expect(pet?.sleepStart).toBeNull();
      expect(pet?.sleepEnd).toBeNull();
    });

    it('租户隔离：alice 设作息不影响 bob 的宠物行', async () => {
      await seedPet('alice');
      await seedPet('bob');
      await app.request(
        await authed('http://x/api/pets/sleep-schedule', {
          method: 'PUT',
          body: JSON.stringify({ startHour: 22, endHour: 7 }),
        }),
      );
      const db = await getDb(dataDir);
      const bobPet = await db.select().from(pets).where(eq(pets.tenantId, 'bob')).get();
      expect(bobPet?.sleepStart).toBeNull();
      expect(bobPet?.sleepEnd).toBeNull();
    });
  });

  describe('日记配置（#92）：PUT /api/pets/diary-style + diary-push', () => {
    async function seedPet(tenantId: string) {
      const db = await getDb(dataDir);
      await db
        .insert(pets)
        .values({
          id: `pet-${tenantId}`,
          tenantId,
          name: '小溜',
          status: 'active',
          lastRunAt: null,
          cooldownUntil: null,
          boredom: 30,
          energy: 80,
        })
        .run();
    }

    it('未登录：PUT 均 401', async () => {
      expect((await app.request('/api/pets/diary-style', { method: 'PUT' })).status).toBe(401);
      expect((await app.request('/api/pets/diary-push', { method: 'PUT' })).status).toBe(401);
    });

    it('未领养 → 409', async () => {
      const res = await app.request(
        await authed('http://x/api/pets/diary-style', {
          method: 'PUT',
          body: JSON.stringify({ diaryStyle: 'literary' }),
        }),
      );
      expect(res.status).toBe(409);
    });

    it('PUT diary-style 设置具体风格，默认 personality 不变', async () => {
      await seedPet('alice');
      const db = await getDb(dataDir);
      // 默认 personality
      let pet = await db.select().from(pets).where(eq(pets.tenantId, 'alice')).get();
      expect(pet?.diaryStyle).toBe('personality');

      const res = await app.request(
        await authed('http://x/api/pets/diary-style', {
          method: 'PUT',
          body: JSON.stringify({ diaryStyle: 'literary' }),
        }),
      );
      expect(res.status).toBe(200);
      pet = await db.select().from(pets).where(eq(pets.tenantId, 'alice')).get();
      expect(pet?.diaryStyle).toBe('literary');
    });

    it('PUT diary-style 非法值 / 非 JSON → 400', async () => {
      await seedPet('alice');
      const bad = async (body: unknown) =>
        app.request(
          await authed('http://x/api/pets/diary-style', {
            method: 'PUT',
            body: typeof body === 'string' ? body : JSON.stringify(body),
          }),
        );
      expect((await bad({ diaryStyle: 'grumpy' })).status).toBe(400);
      expect((await bad('not json')).status).toBe(400);
    });

    it('PUT diary-push 开关生效', async () => {
      await seedPet('alice');
      const db = await getDb(dataDir);
      let pet = await db.select().from(pets).where(eq(pets.tenantId, 'alice')).get();
      expect(pet?.diaryPushEnabled).toBe(false);

      const on = await app.request(
        await authed('http://x/api/pets/diary-push', {
          method: 'PUT',
          body: JSON.stringify({ enabled: true }),
        }),
      );
      expect(on.status).toBe(200);
      pet = await db.select().from(pets).where(eq(pets.tenantId, 'alice')).get();
      expect(pet?.diaryPushEnabled).toBe(true);

      const bad = await app.request(
        await authed('http://x/api/pets/diary-push', {
          method: 'PUT',
          body: JSON.stringify({ enabled: 'yes' }),
        }),
      );
      expect(bad.status).toBe(400);
    });
  });
});

describe('adopt 口头禅（#114 切片 2）', () => {
  let dataDir: string;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-pets-cp-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    app = new Hono();
    const config = { dataDir, sessionSecret: SECRET } as Parameters<
      typeof createPetsRoutes
    >[0]['config'];
    app.route('/api', createPetsRoutes({ config }));
  });

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function authed(url: string, init: RequestInit = {}): Promise<Request> {
    const token = await signSession({ sub: 'alice', tenantId: 'alice' }, SECRET);
    const headers = new Headers(init.headers);
    headers.set('cookie', `${SESSION_COOKIE}=${token}`);
    headers.set('content-type', 'application/json');
    return new Request(url, { ...init, headers });
  }

  it('带 catchphrases：落库 JSON + 演化历史 jsonl + GET 回显', async () => {
    const res = await app.request(
      await authed('http://x/api/pets/adopt', {
        method: 'POST',
        body: JSON.stringify({
          name: '小喵',
          personality: 'playful',
          catchphrases: [
            { text: '喵呜——冲!', weight: 2 },
            { text: '上钩啦', weight: 0.5 },
          ],
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { catchphrases: Array<{ text: string; weight: number }> };
    };
    expect(body.data.catchphrases).toEqual([
      { text: '喵呜——冲!', weight: 2 },
      { text: '上钩啦', weight: 0.5 },
    ]);

    // 落库：DB 列存 JSON 字符串
    const db = await getDb(dataDir);
    const row = await db.select().from(pets).where(eq(pets.tenantId, 'alice')).get();
    expect(JSON.parse(row!.catchphrases!)).toEqual([
      { text: '喵呜——冲!', weight: 2 },
      { text: '上钩啦', weight: 0.5 },
    ]);

    // 演化历史：catchphrase-history.jsonl 一行 reason=adopt
    const historyPath = join(dataDir, 'tenants', 'alice', 'catchphrase-history.jsonl');
    expect(existsSync(historyPath)).toBe(true);
    const lines = readFileSync(historyPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as {
      reason: string;
      catchphrases: Array<{ text: string }>;
    };
    expect(entry.reason).toBe('adopt');
    expect(entry.catchphrases.map((c) => c.text)).toEqual(['喵呜——冲!', '上钩啦']);

    // GET /api/pets 回显有效集合
    const list = await app.request(await authed('http://x/api/pets'));
    const listBody = (await list.json()) as {
      data: Array<{ catchphrases: Array<{ text: string }> }>;
    };
    expect(listBody.data[0]!.catchphrases.map((c) => c.text)).toEqual(['喵呜——冲!', '上钩啦']);
  });

  it('不带 catchphrases：默认 = 所选性格默认组', async () => {
    const res = await app.request(
      await authed('http://x/api/pets/adopt', {
        method: 'POST',
        body: JSON.stringify({ name: '小稳', personality: 'steady' }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { catchphrases: Array<{ text: string }> };
    };
    expect(body.data.catchphrases).toEqual(getPersonality('steady').catchphrases);
  });

  it('非法 catchphrases 400：空数组 / 超长文本 / 负权重 / 非对象', async () => {
    for (const bad of [
      [],
      [{ text: 'x'.repeat(25), weight: 1 }],
      [{ text: '喵', weight: -1 }],
      ['喵'],
    ]) {
      const res = await app.request(
        await authed('http://x/api/pets/adopt', {
          method: 'POST',
          body: JSON.stringify({ name: '坏', catchphrases: bad }),
        }),
      );
      expect(res.status).toBe(400);
    }
  });
});
