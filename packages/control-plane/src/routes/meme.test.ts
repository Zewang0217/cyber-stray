/**
 * meme 图鉴路由 API 契约测试（#96）
 *
 * 契约：
 * - 鉴权：未登录 401；x-tenant-* 忽略；他人租户看不到
 * - 列表：只展示 qcPass=true 的（质检过滤兜底），时间倒序，附 imageUrl
 * - 图片：存在且过质检 → PNG；非法 id 400；未收录/缺失 404
 * - 删除：manifest + 磁盘；不存在 404；删后列表不含
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant } from '../tenant.js';
import { signSession, SESSION_COOKIE } from '../session.js';
import { createMemeRoutes } from './meme.js';
import { memeAssetsDir, memeManifestPath } from '../meme/storage.js';

const SECRET = 'y'.repeat(40);

describe('meme 图鉴路由（#96）', () => {
  let dataDir: string;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-meme-routes-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    await getOrCreateTenant(dataDir, 'bob');
    app = new Hono();
    const config = { dataDir, sessionSecret: SECRET } as Parameters<typeof createMemeRoutes>[0]['config'];
    app.route('/api/meme', createMemeRoutes({ config }));
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
    headers.set('x-tenant-id', 'bob'); // 安全硬规矩：一律忽略
    return new Request(url, { ...init, headers });
  }

  function seedManifest(entries: Array<Record<string, unknown>>): void {
    mkdirSync(memeAssetsDir(join(dataDir, 'tenants', 'alice')), { recursive: true });
    writeFileSync(
      memeManifestPath(join(dataDir, 'tenants', 'alice')),
      JSON.stringify(entries),
    );
  }

  function seedImage(id: string, name: string, bytes = Buffer.from([137, 80, 78, 71])): void {
    writeFileSync(join(memeAssetsDir(join(dataDir, 'tenants', 'alice')), name), bytes);
  }

  it('未登录：全部 401', async () => {
    expect((await app.request('/api/meme')).status).toBe(401);
    expect((await app.request('/api/meme/x/image.png')).status).toBe(401);
    expect((await app.request('/api/meme/x', { method: 'DELETE' })).status).toBe(401);
  });

  it('列表：只展示 qcPass=true（质检过滤），时间倒序，附 imageUrl', async () => {
    seedManifest([
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', topic: '量子计算', emotion: '自嘲', date: '2026-08-20', mode: 'abstract', file: 'meme-a.png', qcPass: true, createdAt: 200 },
      { id: 'aaaaaaaa-0000-0000-0000-000000000002', topic: '摸鱼', emotion: '开心', date: '2026-08-19', mode: 'ip', file: 'meme-b.png', qcPass: true, createdAt: 100 },
      { id: 'aaaaaaaa-0000-0000-0000-000000000003', topic: '未过质检', emotion: '丧', date: '2026-08-20', mode: 'abstract', file: 'meme-c.png', qcPass: false, createdAt: 300 },
    ]);
    const res = await app.request(await authed('http://x/api/meme'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string; topic: string; emotion: string; date: string; imageUrl: string }>;
    };
    expect(body.data).toHaveLength(2);
    // 时间倒序：createdAt 200 在前
    expect(body.data[0]?.id).toBe('aaaaaaaa-0000-0000-0000-000000000001');
    expect(body.data[1]?.id).toBe('aaaaaaaa-0000-0000-0000-000000000002');
    expect(body.data[0]?.topic).toBe('量子计算');
    expect(body.data[0]?.emotion).toBe('自嘲');
    expect(body.data[0]?.date).toBe('2026-08-20');
    expect(body.data[0]?.imageUrl).toContain('/api/meme/aaaaaaaa-0000-0000-0000-000000000001/image.png');
    // 未过质检的不在列表
    expect(body.data.some((m) => m.id.endsWith('003'))).toBe(false);
  });

  it('列表：无 manifest → 空列表', async () => {
    const res = await app.request(await authed('http://x/api/meme'));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown[] }).data).toEqual([]);
  });

  it('租户隔离：alice 看不到 bob 的表情包', async () => {
    seedManifest([
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', topic: 't', emotion: 'e', date: 'd', mode: 'abstract', file: 'meme-a.png', qcPass: true, createdAt: 1 },
    ]);
    const res = await app.request(await authed('http://x/api/meme', {}, { sub: 'bob', tenantId: 'bob' }));
    expect(((await res.json()) as { data: unknown[] }).data).toEqual([]);
  });

  it('图片：存在且过质检 → PNG；非法 id 400；未收录 404', async () => {
    seedManifest([
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', topic: 't', emotion: 'e', date: 'd', mode: 'abstract', file: 'meme-a.png', qcPass: true, createdAt: 1 },
    ]);
    seedImage('a', 'meme-a.png');
    const ok = await app.request(await authed('http://x/api/meme/aaaaaaaa-0000-0000-0000-000000000001/image.png'));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    // 非法 id
    const evil = await app.request(await authed('http://x/api/meme/..%2F..%2Fmaster.key/image.png'));
    expect(evil.status).toBe(400);
    // 未收录（qcPass=false 或不存在）
    const notPass = await app.request(await authed('http://x/api/meme/aaaaaaaa-0000-0000-0000-000000000009/image.png'));
    expect(notPass.status).toBe(404);
  });

  it('删除：manifest + 磁盘；删后列表不含；不存在 404', async () => {
    const id = 'aaaaaaaa-0000-0000-0000-000000000001';
    seedManifest([
      { id, topic: 't', emotion: 'e', date: 'd', mode: 'abstract', file: 'meme-a.png', qcPass: true, createdAt: 1 },
    ]);
    seedImage('a', 'meme-a.png');
    const del = await app.request(await authed(`http://x/api/meme/${id}`, { method: 'DELETE' }));
    expect(del.status).toBe(200);
    expect(existsSync(join(memeAssetsDir(join(dataDir, 'tenants', 'alice')), 'meme-a.png'))).toBe(false);
    const list = await app.request(await authed('http://x/api/meme'));
    expect(((await list.json()) as { data: unknown[] }).data).toEqual([]);
    // 再删不存在 → 404
    const again = await app.request(await authed(`http://x/api/meme/${id}`, { method: 'DELETE' }));
    expect(again.status).toBe(404);
  });
});
