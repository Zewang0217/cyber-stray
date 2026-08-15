/**
 * events 路由测试（S8，#75）
 *
 * 契约：
 * - GET /api/events：SSE 流；鉴权（401）/ 关系行校验（403）与数据路由同规矩
 * - 租户隔离：只收本租户通道事件，他租户 publish 不送达
 * - 帧格式：`data: <TenantEvent JSON>\n\n`；连接建立即发 retry 提示
 * - 断开清理：客户端取消（cancel）后退订，后续 publish 不炸
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant } from '../tenant.js';
import { signSession, SESSION_COOKIE } from '../session.js';
import { createEventBus } from '../events/bus.js';
import { createEventsRoutes } from './events.js';

const SECRET = 'x'.repeat(40);

/**
 * 读流直到攒够 `bytes`。超时只是失败守卫——正常路径完全由流数据驱动，
 * 不做固定时长等待。
 */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  bytes: number,
  timeoutMs = 1000,
): Promise<string> {
  const decoder = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + timeoutMs;
  while (buf.length < bytes) {
    if (Date.now() > deadline) {
      throw new Error(`读流超时，只读到 ${buf.length} 字节: ${buf}`);
    }
    const timer = setTimeout(() => reader.cancel().catch(() => {}), deadline - Date.now());
    try {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    } finally {
      clearTimeout(timer);
    }
  }
  return buf;
}

describe('events 路由（SSE）', () => {
  let dataDir: string;
  let app: Hono;
  let bus: ReturnType<typeof createEventBus>;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-events-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    await getOrCreateTenant(dataDir, 'bob');
    bus = createEventBus();
    app = new Hono();
    const config = { dataDir, sessionSecret: SECRET } as Parameters<
      typeof createEventsRoutes
    >[0]['config'];
    app.route('/api', createEventsRoutes({ config, bus }));
  });

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function authedRequest(claims = { sub: 'alice', tenantId: 'alice' }): Promise<Request> {
    const token = await signSession(claims, SECRET);
    return new Request('http://x/api/events', {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
  }

  it('未登录 401', async () => {
    expect((await app.request('/api/events')).status).toBe(401);
  });

  it('关系行缺失 403', async () => {
    const res = await app.request(await authedRequest({ sub: 'mallory', tenantId: 'alice' }));
    expect(res.status).toBe(403);
  });

  it('SSE 响应头：text/event-stream + no-cache', async () => {
    const res = await app.request(await authedRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    await res.body?.cancel();
  });

  it('租户隔离：只收本租户事件，他租户事件不送达', async () => {
    const res = await app.request(await authedRequest());
    const reader = res.body!.getReader();
    try {
      // 首帧：重连提示（契约：连接建立即发 retry），且订阅已随之生效
      const first = await readUntil(reader, 12);
      expect(first).toContain('retry: 5000');
      // 订阅已生效后再发布
      bus.publish('alice', {
        type: 'worker_succeeded',
        tenantId: 'alice',
        petId: 'p1',
        at: 1,
      });
      bus.publish('bob', {
        type: 'worker_succeeded',
        tenantId: 'bob',
        petId: 'p2',
        at: 2,
      });
      const buf = await readUntil(reader, 1);
      expect(buf).toContain('"tenantId":"alice"');
      expect(buf).not.toContain('"tenantId":"bob"');
    } finally {
      await reader.cancel();
    }
  });

  it('断开退订：cancel 后再 publish 不炸', async () => {
    const res = await app.request(await authedRequest());
    const reader = res.body!.getReader();
    await readUntil(reader, 10);
    await reader.cancel();
    // 退订已发生：再发布不炸（handler 已摘除，不会再向已 cancel 的流 enqueue）
    bus.publish('alice', {
      type: 'worker_succeeded',
      tenantId: 'alice',
      petId: 'p1',
      at: 3,
    });
  });
});
