import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant, tenantDataDir } from '../infra/tenant.js';
import { localDateKey, readTenantUsage } from '../infra/usage.js';
import { SESSION_COOKIE, signSession } from '../auth/session.js';
import { createPetsRoutes } from './pets.js';

const SECRET = 'a'.repeat(40);
describe('候选 API 的服务端额度与持久计量', () => {
  let dataDir: string;
  let app: Hono;
  let cookie: string;
  let provider: ReturnType<typeof vi.fn<() => Promise<Response>>>;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'cp-adoption-api-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'alice');
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key');
    vi.stubEnv('CP_MASTER_KEY', 'a'.repeat(64));
    provider = vi.fn<() => Promise<Response>>(async () => Response.json({
      choices: [{ message: { content: '["小溜","年糕","煤球"]' } }],
      usage: { prompt_tokens: 31, completion_tokens: 13 },
    }));
    vi.stubGlobal('fetch', provider);
    app = new Hono();
    app.route('/api', createPetsRoutes({ config: {
      dataDir, sessionSecret: SECRET, productMode: 'invite_beta', adoptLlmModel: 'deepseek-chat',
      llmBudgetEnabled: true, llmBudgetYuan: { free: 0.5, pro: 2, byok: 2 }, petGenMonthlyQuota: 2,
    } }));
    cookie = `${SESSION_COOKIE}=${await signSession({ sub: 'alice', tenantId: 'alice' }, SECRET)}`;
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    _resetDb();
    await rm(dataDir, { recursive: true, force: true });
  });
  async function request(batch: number, name?: string): Promise<Response> {
    return app.request('http://x/api/pets/adoption-candidates', {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ step: 'name', batch, name }),
    });
  }

  it('并发重放只请求一次并记真实用量；伪造同批不同内容也受服务端总量限制', async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, () => request(0)));
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await readTenantUsage(dataDir, 'alice')).toEqual([
      expect.objectContaining({ tenantId: 'alice', model: 'deepseek-chat', tokens: 44, inputTokens: 31, outputTokens: 13 }),
    ]);
    for (let attempt = 0; attempt < 3; attempt++) expect((await request(0, `名字${attempt}`)).status).toBe(200);
    expect((await request(0, '额外名字')).status).toBe(429);
    expect((await request(4)).status).toBe(400);
    expect(provider).toHaveBeenCalledTimes(4);
  });

  it('提供商漏报用量后持久阻断后续不同批次请求', async () => {
    provider.mockImplementation(async () => Response.json({ choices: [] }));
    expect((await request(0)).status).toBe(502);
    const marker = join(tenantDataDir(dataDir, 'alice'), 'usage-accounting-block.json');
    expect(JSON.parse(await readFile(marker, 'utf8'))).toHaveProperty('reason');
    expect((await request(1)).status).toBe(500);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('预算账本损坏先拦截，并持久保持故障', async () => {
    const usageDir = join(tenantDataDir(dataDir, 'alice'), 'usage');
    await mkdir(usageDir, { recursive: true });
    await writeFile(join(usageDir, `usage-${localDateKey()}.jsonl`), '{broken');
    expect((await request(0)).status).toBe(500);
    expect(provider).not.toHaveBeenCalled();
    await rm(usageDir, { recursive: true });
    expect((await request(1)).status).toBe(500);
    expect(provider).not.toHaveBeenCalled();
  });

  it('成功调用后写入失败也阻断后续花费', async () => {
    const usageDir = join(tenantDataDir(dataDir, 'alice'), 'usage');
    provider.mockImplementation(async () => {
      await writeFile(usageDir, 'usage path became unwritable');
      return Response.json({ choices: [], usage: { prompt_tokens: 31, completion_tokens: 13 } });
    });
    expect((await request(1)).status).toBe(500);
    await rm(usageDir);
    expect((await request(2)).status).toBe(500);
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
