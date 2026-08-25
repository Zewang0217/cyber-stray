/**
 * 应用级统一错误处理测试（#116）
 *
 * 契约：
 * - 未捕获异常 → Hono 全局 onError：JSON 500（{ success:false, error }）
 *   且 logger 落盘结构化行（path/method/tenantId/error/stack）
 * - 有 session 的请求 → 日志行带 tenantId
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { createEventBus } from './events/bus.js';
import { loadConfig } from './config.js';
import { createApp, type AppDeps } from './app.js';
import { initLogger, getLogFilePath, _resetLogger } from './logger.js';
import { signSession, SESSION_COOKIE } from './session.js';
import type { OidcProvider, OidcUser } from './oidc.js';

const SECRET = 'test-session-secret-0123456789abcdef0123456789abcdef';

function makeConfig(dataDir: string) {
  return loadConfig({
    CP_SESSION_SECRET: SECRET,
    CP_DATA_DIR: dataDir,
    CP_WEB_ORIGIN: 'http://localhost:3000',
    CASDOOR_ISSUER: 'http://localhost:8000',
    CASDOOR_CLIENT_ID: 'test-client',
    CASDOOR_CLIENT_SECRET: 'test-secret',
    CASDOOR_REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
  } as NodeJS.ProcessEnv);
}

/** mock OIDC：authorize 跳转 + 回调返回固定用户 */
function makeMockOidc(user: OidcUser = { sub: 'casdoor-user-42', email: 'a@b.c' }): OidcProvider {
  return {
    buildAuthUrl: vi.fn(async () => ({
      url: 'http://casdoor.local/login?state=st',
      state: 'st',
      nonce: 'n',
      verifier: 'v',
    })),
    handleCallback: vi.fn(async () => user),
  };
}

/** 读取今日日志文件全部行（不存在返回 []） */
function readLogLines(dataDir: string): Array<Record<string, unknown>> {
  const path = getLogFilePath();
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('应用统一错误处理（#116）', () => {
  let dataDir: string;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-app-log-'));
    initLogger(dataDir);
    const deps: AppDeps = {
      config: makeConfig(dataDir),
      oidc: makeMockOidc(),
      bus: createEventBus(),
    };
    app = createApp(deps);
    // 注册一个抛错路由验证 onError 兜底
    app.get('/boom', () => {
      throw new Error('simulated crash');
    });
  });

  afterEach(() => {
    _resetLogger();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('未捕获异常 → 500 JSON + 日志行（path/method/error/stack）', async () => {
    const res = await app.request('/boom');
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ success: false, error: '服务器内部错误' });

    const lines = readLogLines(dataDir);
    expect(lines.length).toBeGreaterThan(0);
    const entry = lines.find((l) => l.message === '未捕获异常')!;
    expect(entry.level).toBe('error');
    expect(entry.data).toMatchObject({
      path: '/boom',
      method: 'GET',
      tenantId: null,
      error: 'simulated crash',
    });
    expect((entry.data as Record<string, unknown>).stack).toContain('simulated crash');
  });

  it('带 session 的请求 → 日志行带 tenantId', async () => {
    const token = await signSession({ sub: 'alice', tenantId: 'alice' }, SECRET);
    const res = await app.request('/boom', {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status).toBe(500);

    const lines = readLogLines(dataDir);
    const entry = lines.find((l) => l.message === '未捕获异常')!;
    expect((entry.data as Record<string, unknown>).tenantId).toBe('alice');
  });
});
