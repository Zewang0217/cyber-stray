/**
 * 微信测试共享设施（#97）：mock fetch 客户端 + DB/租户种子。
 */

import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { vi } from 'vitest';
import { _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { loadMasterKey } from '../secrets/master-key.js';
import { IlinkClient } from './client.js';

export const MOCK_BASE = 'https://mock.ilink.test';

/** 顺序脚本 fetch：每次调用弹出一个 handler（取完报错） */
export function scriptedFetch(handlers: Array<() => unknown>) {
  let idx = 0;
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method ?? 'GET', body: (init?.body as string) ?? null });
    const handler = handlers[idx++];
    if (!handler) throw new Error(`scriptedFetch: 超出脚本长度（第 ${idx} 次调用 ${u}）`);
    const result = handler();
    const text = typeof result === 'string' ? result : JSON.stringify(result);
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { client: new IlinkClient({ baseUrl: MOCK_BASE, fetchFn: fetchFn as unknown as typeof fetch }), calls, fetchFn };
}

/** 临时数据目录 + DB 迁移 + master key（每个测试一套隔离状态） */
export async function setupTestDataDir(): Promise<string> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cp-wechat-'));
  _resetDb();
  await runMigrations(dataDir);
  writeFileSync(join(dataDir, 'master.key'), 'ab'.repeat(32), { mode: 0o600 });
  await loadMasterKey(dataDir);
  return dataDir;
}

/** 构造带 mock fetch 的 IlinkClient（注入 baseUrl/botToken；responder 可按 URL 分支） */
export function mockIlinkClient(
  responder: (url: string, body: string | null) => unknown,
  opts: { baseUrl?: string; botToken?: string } = {},
): { client: IlinkClient; calls: Array<{ url: string; method: string; body: string | null }> } {
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = (init?.body as string) ?? null;
    calls.push({ url: u, method: init?.method ?? 'GET', body });
    const result = responder(u, body);
    const text = typeof result === 'string' ? result : JSON.stringify(result);
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return {
    client: new IlinkClient({
      baseUrl: opts.baseUrl ?? MOCK_BASE,
      ...(opts.botToken ? { botToken: opts.botToken } : {}),
      fetchFn: fetchFn as unknown as typeof fetch,
    }),
    calls,
  };
}

/** 从 calls 里取 sendmessage 请求（to/text/context_token） */
export function sentMessages(
  calls: Array<{ url: string; body: string | null }>,
): Array<{ to: string; text: string; contextToken?: string }> {
  return calls
    .filter((c) => c.url.includes('/sendmessage'))
    .map((c) => {
      const body = JSON.parse(c.body ?? '{}') as {
        msg?: { to_user_id?: string; item_list?: { text_item?: { text?: string } }[]; context_token?: string };
      };
      return {
        to: body.msg?.to_user_id ?? '',
        text: body.msg?.item_list?.[0]?.text_item?.text ?? '',
        ...(body.msg?.context_token ? { contextToken: body.msg.context_token } : {}),
      };
    });
}
