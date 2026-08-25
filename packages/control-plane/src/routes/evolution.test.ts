import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant, tenantDataDir } from '../tenant.js';
import { signSession, SESSION_COOKIE } from '../session.js';
import { createEvolutionRoutes } from './evolution.js';

const SECRET = 'x'.repeat(40);

describe('evolution 路由（进化可视化 + 回滚）', () => {
  let dataDir: string;
  let app: Hono;

  function tenantDir(tenantId: string): string {
    return tenantDataDir(dataDir, tenantId);
  }

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-evo-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    await getOrCreateTenant(dataDir, 'bob');
    app = new Hono();
    app.route('/api/evolution', createEvolutionRoutes({ config: { dataDir, sessionSecret: SECRET } }));
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
    headers.set('x-tenant-id', 'bob'); // 越权尝试：必须被忽略
    return new Request(url, { ...init, headers });
  }

  function seedEvolutionData(): void {
    const dir = tenantDir('alice');
    mkdirSync(join(dir, 'history'), { recursive: true });
    // 兴趣快照序列（3 条，含 hash）
    const snapshots = [
      {
        timestamp: '2026-08-15T08:00:00.000Z',
        hash: 'a1b2c3d4e5f60718',
        entropy: 0.9,
        nodes: [
          { id: '科技', weight: 0.5, effectiveWeight: 0.5, source: 'default', reinforceCount: 0 },
          { id: '天文', weight: 0.5, effectiveWeight: 0.5, source: 'default', reinforceCount: 0 },
        ],
      },
      {
        timestamp: '2026-08-15T12:00:00.000Z',
        hash: 'b2c3d4e5f6071829',
        entropy: 0.8,
        nodes: [
          { id: '科技', weight: 0.6, effectiveWeight: 0.6, source: 'default', reinforceCount: 1 },
          { id: '天文', weight: 0.7, effectiveWeight: 0.7, source: 'default', reinforceCount: 1 },
        ],
      },
      {
        timestamp: '2026-08-15T16:00:00.000Z',
        hash: 'c3d4e5f60718293a',
        entropy: 0.7,
        nodes: [
          { id: '科技', weight: 0.55, effectiveWeight: 0.55, source: 'default', reinforceCount: 2 },
          { id: '天文', weight: 0.85, effectiveWeight: 0.85, source: 'default', reinforceCount: 2 },
          { id: '量子计算', weight: 0.3, effectiveWeight: 0.3, source: 'feedback', reinforceCount: 1 },
        ],
      },
    ];
    writeFileSync(
      join(dir, 'interest-history.jsonl'),
      snapshots.map((s) => JSON.stringify(s)).join('\n') + '\n',
    );
    // 当前 interests.json（= snap-3 状态）
    writeFileSync(
      join(dir, 'interests.json'),
      JSON.stringify({ version: 1, lastUpdated: '2026-08-15T16:00:00.000Z', nodes: snapshots[2]!.nodes }),
    );
    // 反馈
    writeFileSync(
      join(dir, 'feedback.json'),
      JSON.stringify({
        feedbacks: [
          { type: 'boost', topic: '天文', timestamp: '2026-08-15T14:00:00.000Z' },
          { type: 'like', messageId: 'm1', timestamp: '2026-08-15T15:00:00.000Z' },
        ],
      }),
    );
    // 状态摘要
    writeFileSync(
      join(dir, 'state.json'),
      JSON.stringify({ totalWanders: 10, totalPushes: 8 }),
    );
  }

  it('GET /api/evolution：快照序列 + 反馈事件 + 摘要（限本租户）', async () => {
    seedEvolutionData();
    const res = await app.request(await authed('http://x/api/evolution'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { snapshots: unknown[]; feedbacks: unknown[]; summary: { totalWanders: number } };
    };
    expect(json.data.snapshots).toHaveLength(3);
    expect(json.data.feedbacks).toHaveLength(2);
    expect(json.data.summary.totalWanders).toBe(10);
  });

  it('GET 未登录 401；跨租户 session 不泄漏（bob 看不到 alice 数据）', async () => {
    seedEvolutionData();
    const res = await app.request(
      await authed('http://x/api/evolution', {}, { sub: 'bob', tenantId: 'bob' }),
    );
    // bob 有自己租户（无数据），应返回空而非 alice 数据
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { snapshots: unknown[] } };
    expect(json.data.snapshots).toHaveLength(0);

    const anon = await app.request(new Request('http://x/api/evolution'));
    expect(anon.status).toBe(401);
  });

  it('POST /api/evolution/rollback：回滚到指定快照，interests.json 还原且追加回滚快照', async () => {
    seedEvolutionData();
    const res = await app.request(
      await authed('http://x/api/evolution/rollback', {
        method: 'POST',
        body: JSON.stringify({ hash: 'a1b2c3d4e5f60718' }),
      }),
    );
    expect(res.status).toBe(200);

    // interests.json 还原为 snap-1 的两节点权重
        const current = JSON.parse(readFileSync(join(tenantDir('alice'), 'interests.json'), 'utf-8')) as {
      nodes: Array<{ id: string; weight: number }>;
    };
    expect(current.nodes).toHaveLength(2);
    expect(current.nodes.find((n) => n.id === '天文')?.weight).toBe(0.5);

    // 历史追加一条回滚快照（hash 不同）
    const hist = readFileSync(join(tenantDir('alice'), 'interest-history.jsonl'), 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean);
    expect(hist).toHaveLength(4);
    const last = JSON.parse(hist.at(-1) ?? '') as { source?: string; nodes: unknown[] };
    expect(last.source).toBe('rollback');
    expect(last.nodes).toHaveLength(2);
  });

  it('rollback 接受 agent 实际 8 位 hex hash（DJB2，interest-history.ts 格式）', async () => {
    // 模拟 agent 落盘：8 位 hex hash（真实格式）
    const dir = tenantDir('alice');
    mkdirSync(join(dir, 'history'), { recursive: true });
    writeFileSync(
      join(dir, 'interest-history.jsonl'),
      JSON.stringify({
        timestamp: '2026-08-15T08:00:00.000Z',
        hash: '398b76dd',
        entropy: 0.9,
        nodes: [{ id: '科技', weight: 0.5, source: 'default', reinforceCount: 0 }],
      }) + '\n',
    );
    writeFileSync(
      join(dir, 'interests.json'),
      JSON.stringify({ version: 1, lastUpdated: '2026-08-15T08:00:00.000Z', nodes: [] }),
    );
    const res = await app.request(
      await authed('http://x/api/evolution/rollback', {
        method: 'POST',
        body: JSON.stringify({ hash: '398b76dd' }),
      }),
    );
    expect(res.status).toBe(200);
        const current = JSON.parse(readFileSync(join(dir, 'interests.json'), 'utf-8')) as {
      nodes: Array<{ id: string }>;
    };
    expect(current.nodes).toHaveLength(1);
    expect(current.nodes[0]?.id).toBe('科技');
  });

  it('rollback：未知 hash → 404；他租户 hash → 404（不暴露存在性）', async () => {
    seedEvolutionData();
    const bad = await app.request(
      await authed('http://x/api/evolution/rollback', {
        method: 'POST',
        body: JSON.stringify({ hash: 'ffffffffffffffff' }),
      }),
    );
    expect(bad.status).toBe(404);

    // bob 尝试用 alice 的 hash
    const cross = await app.request(
      await authed(
        'http://x/api/evolution/rollback',
        { method: 'POST', body: JSON.stringify({ hash: 'a1b2c3d4e5f60718' }) },
        { sub: 'bob', tenantId: 'bob' },
      ),
    );
    expect(cross.status).toBe(404);
  });

  it('rollback：无历史文件 → 404（禁兜底）', async () => {
    const res = await app.request(
      await authed('http://x/api/evolution/rollback', {
        method: 'POST',
        body: JSON.stringify({ hash: 'a1b2c3d4e5f60718' }),
      }),
    );
    expect(res.status).toBe(404);
  });
});
