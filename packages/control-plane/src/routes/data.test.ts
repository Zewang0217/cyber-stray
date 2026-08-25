/**
 * data 路由测试（S6，#73）
 *
 * 契约：
 * - /api/{state,interests,interests/history,history} 鉴权：无/坏 session → 401
 * - 按会话租户路由：读 tenants/<sub>/ 数据目录，不碰其他租户/控制面根
 * - 跨租户访问拒：session tenantId 在 user_tenants 无关系行 → 403
 *   （伪造 x-tenant-* header 无效：租户只由 session claim 决定）
 * - 只读：路由全程零写入（数据目录 mtime/内容不变）
 * - 响应 shape 与 web 旧路由一致（{success, data}）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant } from '../tenant.js';
import { signSession, SESSION_COOKIE } from '../session.js';
import { createDataRoutes } from './data.js';

const SECRET = 'x'.repeat(40);

describe('data 路由（租户数据 + 鉴权）', () => {
  let dataDir: string;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-data-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    await getOrCreateTenant(dataDir, 'bob');
    // alice 的数据目录写测试数据
    const aliceDir = join(dataDir, 'tenants', 'alice');
    writeFileSync(
      join(aliceDir, 'state.json'),
      JSON.stringify({ mood: 'curious', boredom: 10, energy: 90 }),
    );
    writeFileSync(
      join(aliceDir, 'interests.json'),
      JSON.stringify({ nodes: [{ topic: 'ai', weight: 5 }], lastUpdated: '2026-08-15' }),
    );
    mkdirSync(join(aliceDir, 'history'), { recursive: true });
    writeFileSync(
      join(aliceDir, 'history', 'speaks-2026.jsonl'),
      JSON.stringify({ content: 'hi', type: 'nonsense', timestamp: '2026-08-15T00:00:00Z' }) +
        '\n',
    );

    app = new Hono();
    const config = {
      dataDir,
      sessionSecret: SECRET,
    } as Parameters<typeof createDataRoutes>[0]['config'];
    app.route('/api', createDataRoutes({ config }));
  });

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  /** 签 session 并构造带 cookie 的请求 */
  async function authedAsync(url: string, claims = { sub: 'alice', tenantId: 'alice' }) {
    const token = await signSession(claims, SECRET);
    return new Request(url, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
  }

  it('坏 token 401', async () => {
    const res = await app.request('/api/state', {
      headers: { cookie: `${SESSION_COOKIE}=not-a-jwt` },
    });
    expect(res.status).toBe(401);
  });

  it('state：按租户路由返回 alice 数据', async () => {
    const res = await app.request(await authedAsync('http://x/api/state'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { mood: string } };
    expect(body.success).toBe(true);
    expect(body.data.mood).toBe('curious');
  });

  it('interests：节点 + 熵值（shape 与 web 旧路由一致）', async () => {
    const res = await app.request(await authedAsync('http://x/api/interests'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { nodes: unknown[]; entropy: number; nodeCount: number; lastUpdated: string | null };
    };
    expect(body.data.nodes).toHaveLength(1);
    expect(body.data.entropy).toBe(0);
    expect(body.data.nodeCount).toBe(1);
    expect(body.data.lastUpdated).toBe('2026-08-15');
  });

  it('history：JSONL 解析为倒序列表', async () => {
    const res = await app.request(await authedAsync('http://x/api/history'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { message: string; timestamp: string }[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.message).toBe('hi');
  });

  it('history 分页（#123）：limit/offset 切片 + hasMore + total', async () => {
    const aliceDir = join(dataDir, 'tenants', 'alice');
    const lines = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify({
        content: `msg-${i}`,
        type: 'nonsense',
        timestamp: `2026-08-1${i}T00:00:00Z`,
      }),
    ).join('\n');
    writeFileSync(join(aliceDir, 'history', 'speaks-paged.jsonl'), lines + '\n');

    const page0 = (await (await app.request(await authedAsync('http://x/api/history?limit=2&offset=0'))).json()) as {
      data: { message: string }[];
      pagination: { total: number; offset: number; limit: number; hasMore: boolean };
    };
    expect(page0.data).toHaveLength(2);
    expect(page0.data[0]!.message).toBe('hi'); // setup 的 08-15 最新，倒序第一
    expect(page0.data[1]!.message).toBe('msg-4');
    expect(page0.pagination).toMatchObject({ total: 6, offset: 0, limit: 2, hasMore: true });

    const page2 = (await (await app.request(await authedAsync('http://x/api/history?limit=2&offset=2'))).json()) as {
      data: { message: string }[];
      pagination: { hasMore: boolean };
    };
    expect(page2.data[0]!.message).toBe('msg-3');
    expect(page2.pagination.hasMore).toBe(true);

    const last = (await (await app.request(await authedAsync('http://x/api/history?limit=2&offset=4'))).json()) as {
      data: { message: string }[];
      pagination: { hasMore: boolean };
    };
    expect(last.data).toHaveLength(2); // msg-1, msg-0（含 setup 的 'hi' 共 6 条）
    expect(last.pagination.hasMore).toBe(false);
  });

  it('history 分页边界：limit 钳制在 [1,200]，offset 负值归 0', async () => {
    const res = await app.request(await authedAsync('http://x/api/history?limit=9999&offset=-3'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; pagination: { limit: number; offset: number } };
    expect(body.pagination.limit).toBe(200);
    expect(body.pagination.offset).toBe(0);
  });

  it('租户隔离：bob 的 session 读不到 alice 数据（bob 目录为空 → 空数据/200）', async () => {
    const res = await app.request(
      await authedAsync('http://x/api/state', { sub: 'bob', tenantId: 'bob' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data?: unknown };
    // bob 无 state.json：返回空/失败但不吐 alice 数据
    expect(JSON.stringify(body)).not.toContain('curious');
  });

  it('跨租户拒绝：session tenant 无 user_tenants 关系行 → 403', async () => {
    // carol 没建过租户（无 tenants 行、无关系行），但签了合法 session
    const res = await app.request(
      await authedAsync('http://x/api/state', { sub: 'carol', tenantId: 'carol' }),
    );
    expect(res.status).toBe(403);
  });

  it('损坏的 state.json → 500（不吞成空态）', async () => {
    const aliceDir = join(dataDir, 'tenants', 'alice');
    writeFileSync(join(aliceDir, 'state.json'), '{corrupted json');
    const res = await app.request(await authedAsync('http://x/api/state'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(false);
  });

  it('state.json 缺失 → 200 data:null 空态', async () => {
    rmSync(join(dataDir, 'tenants', 'alice', 'state.json'));
    const res = await app.request(await authedAsync('http://x/api/state'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toBeNull();
  });

  it('伪造 x-tenant header 无效：仍按 session claim 路由', async () => {
    const token = await signSession({ sub: 'bob', tenantId: 'bob' }, SECRET);
    const res = await app.request('http://x/api/state', {
      headers: { cookie: `${SESSION_COOKIE}=${token}`, 'x-tenant-id': 'alice' },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain('curious'); // bob 的空数据，不是 alice 的
  });


  it('只读：请求全程不写租户数据目录', async () => {
    const snapshot = dirSnapshot(join(dataDir, 'tenants'));
    for (const path of ['/api/state', '/api/interests', '/api/history', '/api/interests/history']) {
      await app.request(await authedAsync(`http://x${path}`));
    }
    expect(dirSnapshot(join(dataDir, 'tenants'))).toEqual(snapshot);
  });
});

/** 目录快照：路径 → [mtimeMs, size]（检测任何写入） */
function dirSnapshot(root: string): Map<string, [number, number]> {
  const snap = new Map<string, [number, number]>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else {
        const s = statSync(p);
        snap.set(p, [s.mtimeMs, s.size]);
      }
    }
  };
  walk(root);
  return snap;
}
