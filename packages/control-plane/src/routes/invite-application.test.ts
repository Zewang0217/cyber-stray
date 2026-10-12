import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { getDb, _resetDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getOrCreateTenant } from '../infra/tenant.js';
import { signSession, SESSION_COOKIE } from '../auth/session.js';
import { createApplyRoutes } from './invite-application.js';
import { createAdminRoutes } from './admin.js';
import { isApplicationId, isApplicationSecret } from '@cyber-stray/shared/invite-application';
import { isInviteToken } from '@cyber-stray/shared/invite';

const SECRET = 'x'.repeat(40);
const WEB_ORIGIN = 'https://app.example.com';

/** 公开申请 → admin 审批 → 凭据对取码 的完整闭环（同一 dataDir 上两个路由组） */
describe('邀请申请（公开提交 + admin 审批 + 凭据对取码）', () => {
  let dataDir: string;
  let app: Hono;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-apply-'));
    _resetDb();
    await runMigrations(dataDir);
    await getOrCreateTenant(dataDir, 'admin-tenant');
    app = new Hono();
    app.route('/api/apply', createApplyRoutes({ config: { dataDir, webOrigin: WEB_ORIGIN } }));
    app.route('/api/admin', createAdminRoutes({
      config: {
        dataDir, sessionSecret: SECRET, webOrigin: WEB_ORIGIN, adminSubs: ['admin-1'],
        productMode: 'invite_beta', arkImageModel: 'default-img', visionModel: 'default-vl',
        llmBudgetEnabled: false, llmBudgetYuan: { free: 0, pro: 0, byok: 0 },
      },
    }));
  });

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function adminPost(url: string): Promise<Response> {
    const token = await signSession({ sub: 'admin-1', tenantId: 'admin-tenant' }, SECRET);
    return app.request(url, {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
  }

  async function adminGet(url: string): Promise<Response> {
    const token = await signSession({ sub: 'admin-1', tenantId: 'admin-tenant' }, SECRET);
    return app.request(url, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
  }

  async function submit(reason = '想看它自己冲浪找复古掌机和像素画的内容'): Promise<{ applicationId: string; secret: string }> {
    const res = await app.request('http://x/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
      body: JSON.stringify({ nickname: '像素猫', reason }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { applicationId: string; secret: string } };
    expect(body.success).toBe(true);
    return body.data;
  }

  async function query(id: string, secret: string): Promise<Response> {
    return app.request(`http://x/api/apply/status?id=${id}&secret=${secret}`, {
      headers: { 'x-forwarded-for': '203.0.113.8' },
    });
  }

  it('提交申请 → 返回凭据对（格式合法，secret 只出现一次）', async () => {
    const creds = await submit();
    expect(isApplicationId(creds.applicationId)).toBe(true);
    expect(isApplicationSecret(creds.secret)).toBe(true);
  });

  it('校验：理由太短 400；非 JSON 400', async () => {
    const short = await app.request('http://x/api/apply', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: '太短' }),
    });
    expect(short.status).toBe(400);
    const notJson = await app.request('http://x/api/apply', { method: 'POST', body: 'nope' });
    expect(notJson.status).toBe(400);
  });

  it('查询：凭据对正确返回 pending；错误凭据 404；格式不对 400', async () => {
    const { applicationId, secret } = await submit();
    const ok = await query(applicationId, secret);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { data: { status: string } }).data.status).toBe('pending');

    const wrong = await query(applicationId, '0'.repeat(32));
    expect(wrong.status).toBe(404);

    const bad = await query('not-an-id', secret);
    expect(bad.status).toBe(400);
  });

  it('admin 批准 → 查询返回可用邀请链接；重复批准 400；回绝走 reject', async () => {
    const { applicationId, secret } = await submit();

    const list = await adminGet('http://x/api/admin/applications');
    expect(list.status).toBe(200);
    const listBody = await list.json() as { data: Array<{ id: string; publicId: string; secretHash?: string }> };
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0]?.secretHash).toBeUndefined(); // 凭据哈希不出 CP
    const applicationRowId = listBody.data[0]?.id as string;
    expect(listBody.data[0]?.publicId).toBe(applicationId);

    const approve = await adminPost(`http://x/api/admin/applications/${applicationRowId}/approve`);
    expect(approve.status).toBe(200);

    const again = await adminPost(`http://x/api/admin/applications/${applicationRowId}/approve`);
    expect(again.status).toBe(400); // 已处理过

    const status = await query(applicationId, secret);
    const statusBody = (await status.json()) as { data: { status: string; inviteUrl?: string } };
    expect(statusBody.data.status).toBe('approved');
    const token = statusBody.data.inviteUrl?.split('invite=')[1] ?? '';
    expect(statusBody.data.inviteUrl?.startsWith(`${WEB_ORIGIN}/?invite=`)).toBe(true);
    expect(isInviteToken(token)).toBe(true);
  });

  it('admin 回绝 → 查询返回 rejected（无链接）', async () => {
    const { applicationId, secret } = await submit();
    const list = await adminGet('http://x/api/admin/applications');
    const id = ((await list.json()) as { data: Array<{ id: string }> }).data[0]?.id as string;
    const reject = await adminPost(`http://x/api/admin/applications/${id}/reject`);
    expect(reject.status).toBe(200);
    const status = await query(applicationId, secret);
    expect(((await status.json()) as { data: { status: string } }).data.status).toBe('rejected');
  });

  it('admin 端点对非管理员 403 / 未登录 401', async () => {
    const anon = await app.request('http://x/api/admin/applications');
    expect(anon.status).toBe(401);
    const token = await signSession({ sub: 'user-9', tenantId: 'admin-tenant' }, SECRET);
    const res = await app.request('http://x/api/admin/applications', {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status).toBe(403);
  });

  it('限流：同一 IP 提交超 5 次/小时 → 429；其他 IP 不受连坐', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await app.request('http://x/api/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.9' },
        body: JSON.stringify({ reason: '每一条理由都够八个字吗' }),
      });
      expect(res.status).toBe(200);
    }
    const sixth = await app.request('http://x/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.9' },
      body: JSON.stringify({ reason: '每一条理由都够八个字吗' }),
    });
    expect(sixth.status).toBe(429);
    const other = await app.request('http://x/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.10' },
      body: JSON.stringify({ reason: '每一条理由都够八个字吗' }),
    });
    expect(other.status).toBe(200);
  });
});
