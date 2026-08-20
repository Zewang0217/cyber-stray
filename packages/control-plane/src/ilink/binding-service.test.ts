/**
 * 绑定状态机 + 扫码即用 onboarding 测试（#97）
 *
 * 契约：
 * - start → get_bot_qrcode → 返回二维码 URL；后台轮询 get_qrcode_status
 * - confirmed → 自动建租户 + 默认宠物 + 免费档 + bot_token 加密存储 +
 *   wechat_bindings 行（租户锚点 = ilink_user_id）
 * - 超时（wait 到 TTL）→ expired 明确反馈
 * - 他人扫码：scaned 观察身份 ≠ confirmed 身份 → error；重扫（已有绑定）
 *   confirmed 身份 ≠ 既有主人 → error（pairing 白名单防抢绑）
 * - QR 过期 → 刷新 ≤3 次后 expired；scaned_but_redirect → 轮询切 host
 *
 * 等待策略：注入 no-op sleepFn（循环在微任务间空转），await
 * service.waitSettled(id) 等终态——不用真实时钟轮询。超时用例用
 * vi.useFakeTimers 确定性推进。
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { rmSync } from 'fs';
import { getDb, _resetDb } from '../db/client.js';
import { wechatBindings, tenants, pets, userTenants } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { BindingService } from './binding-service.js';
import {
  deriveTenantId,
  getBinding,
  ILINK_BOT_TOKEN_SECRET,
  provisionWechatTenant,
} from './bindings.js';
import { scriptedFetch, mockIlinkClient, setupTestDataDir } from './test-helpers.js';
import { openTenantSecrets } from '../secrets/tenant-secrets.js';

const CONFIRMED = {
  status: 'confirmed',
  bot_token: 'v1_bot_token',
  ilink_bot_id: 'bot123@im.bot',
  baseurl: 'https://ilinkai.weixin.qq.com',
  ilink_user_id: 'owner@im.wechat',
} as const;

const OWNER = 'owner@im.wechat';

describe('绑定状态机', () => {
  let dataDir: string;

  afterEach(() => {
    vi.useRealTimers();
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('start 返回二维码 URL + 会话；wait → confirmed → 建租户/宠物/免费档/token/绑定行', async () => {
    dataDir = await setupTestDataDir();
    const { client, calls } = scriptedFetch([
      () => ({ qrcode: 'qr-1', qrcode_img_content: 'https://qr.example/1' }),
      () => CONFIRMED,
    ]);
    const service = new BindingService({
      dataDir,
      client: () => client,
      pollIntervalMs: 1,
      sleepFn: async () => {},
    });

    const start = await service.start();
    expect(start.qrcodeImgUrl).toBe('https://qr.example/1');
    expect(start.sessionId).toBeTruthy();
    expect(calls[0]!.url).toContain('/ilink/bot/get_bot_qrcode');

    await service.waitSettled(start.sessionId);
    const status = service.getStatus(start.sessionId);
    expect(status.status).toBe('confirmed');
    expect(status.result?.tenantId).toBe(deriveTenantId(OWNER));
    expect(status.result?.petName).toBe('街溜子');
    expect(status.result?.created).toBe(true);

    // onboarding 落库断言
    const db = await getDb(dataDir);
    const tenant = await db.select().from(tenants).where(eq(tenants.id, deriveTenantId(OWNER))).get();
    expect(tenant?.plan).toBe('free');
    const rel = await db
      .select()
      .from(userTenants)
      .where(eq(userTenants.tenantId, deriveTenantId(OWNER)))
      .get();
    expect(rel?.role).toBe('owner');
    const pet = await db.select().from(pets).where(eq(pets.tenantId, deriveTenantId(OWNER))).get();
    expect(pet?.name).toBe('街溜子');
    const binding = await getBinding(db, deriveTenantId(OWNER));
    expect(binding?.ilinkBotId).toBe('bot123@im.bot');
    expect(binding?.ilinkUserId).toBe(OWNER);
    expect(binding?.status).toBe('paired'); // 激活等主人第一条消息

    // bot_token 加密存储（S4 信封，可回读）
    const store = await openTenantSecrets(dataDir, deriveTenantId(OWNER));
    expect(await store.get(ILINK_BOT_TOKEN_SECRET)).toBe('v1_bot_token');
  });

  it('重扫（同主人新 bot）：复用既有租户，更新 bot 身份，不新建', async () => {
    dataDir = await setupTestDataDir();
    // 先落一个既有绑定（模拟首扫）
    await provisionWechatTenant(dataDir, CONFIRMED as never);
    const db = await getDb(dataDir);
    expect((await db.select().from(tenants).all()).length).toBe(1);

    const { client } = scriptedFetch([
      () => ({ qrcode: 'qr-2', qrcode_img_content: 'https://qr.example/2' }),
      () => ({ ...CONFIRMED, bot_token: 'v2_bot_token', ilink_bot_id: 'bot456@im.bot' }),
    ]);
    const service = new BindingService({
      dataDir,
      client: () => client,
      pollIntervalMs: 1,
      sleepFn: async () => {},
    });
    const start = await service.start();
    await service.waitSettled(start.sessionId);
    const status = service.getStatus(start.sessionId);

    expect(status.status).toBe('confirmed');
    expect(status.result?.created).toBe(false);
    expect(status.result?.tenantId).toBe(deriveTenantId(OWNER));
    // 仍只有一个租户；绑定行更新为新 bot + token
    expect((await db.select().from(tenants).all()).length).toBe(1);
    const binding = await getBinding(db, deriveTenantId(OWNER));
    expect(binding?.ilinkBotId).toBe('bot456@im.bot');
    expect(binding?.status).toBe('paired');
    const store = await openTenantSecrets(dataDir, deriveTenantId(OWNER));
    expect(await store.get(ILINK_BOT_TOKEN_SECRET)).toBe('v2_bot_token');
  });

  it('超时：全程 wait 到 TTL → expired（明确反馈"绑定超时"）', async () => {
    vi.useFakeTimers();
    dataDir = await setupTestDataDir();
    let n = 0;
    const { client } = mockIlinkClient(() => {
      n++;
      // 第 1 次调用是 get_bot_qrcode（返回二维码），之后全是 wait
      return n === 1
        ? { qrcode: 'qr-t', qrcode_img_content: 'https://qr.example/t' }
        : { status: 'wait' };
    });
    const service = new BindingService({
      dataDir,
      client: () => client,
      pollIntervalMs: 1000,
      sessionTtlMs: 5000,
    });
    const start = await service.start();
    const settled = service.waitSettled(start.sessionId);
    await vi.advanceTimersByTimeAsync(60_000);
    await settled;
    const status = service.getStatus(start.sessionId);
    expect(status.status).toBe('expired');
    expect(status.error).toBe('绑定超时,请重新发起');
  });

  it('他人扫码（首扫）：scaned 观察身份 ≠ confirmed 身份 → error', async () => {
    dataDir = await setupTestDataDir();
    const { client } = scriptedFetch([
      () => ({ qrcode: 'qr-3', qrcode_img_content: 'https://qr.example/3' }),
      () => ({ status: 'scaned', ilink_user_id: 'scanner@im.wechat' }),
      () => ({ ...CONFIRMED, ilink_user_id: 'attacker@im.wechat' }),
    ]);
    const service = new BindingService({
      dataDir,
      client: () => client,
      pollIntervalMs: 1,
      sleepFn: async () => {},
    });
    const start = await service.start();
    await service.waitSettled(start.sessionId);
    const status = service.getStatus(start.sessionId);
    expect(status.status).toBe('error');
    expect(status.error).toContain('他人扫码');
    // 未落库
    const db = await getDb(dataDir);
    expect((await db.select().from(wechatBindings).all()).length).toBe(0);
  });

  it('他人扫码（重扫）：confirmed 身份 ≠ 既有主人 → error（pairing 白名单）', async () => {
    dataDir = await setupTestDataDir();
    await provisionWechatTenant(dataDir, CONFIRMED as never);
    const { client } = scriptedFetch([
      () => ({ qrcode: 'qr-4', qrcode_img_content: 'https://qr.example/4' }),
      () => ({ ...CONFIRMED, ilink_user_id: 'hijacker@im.wechat' }),
    ]);
    const service = new BindingService({
      dataDir,
      client: () => client,
      pollIntervalMs: 1,
      sleepFn: async () => {},
    });
    // 带 tenantId 发起重扫 → 服务端以既有主人做白名单
    const start = await service.start(deriveTenantId(OWNER));
    await service.waitSettled(start.sessionId);
    const status = service.getStatus(start.sessionId);
    expect(status.status).toBe('error');
    expect(status.error).toContain('他人扫码');
    expect(status.error).toContain('重新扫码');
  });

  it('QR 过期：刷新 ≤3 次后仍过期 → expired', async () => {
    dataDir = await setupTestDataDir();
    const { client } = scriptedFetch([
      () => ({ qrcode: 'qr-a', qrcode_img_content: 'https://qr.example/a' }),
      () => ({ status: 'expired' }),
      () => ({ qrcode: 'qr-b', qrcode_img_content: 'https://qr.example/b' }),
      () => ({ status: 'expired' }),
      () => ({ qrcode: 'qr-c', qrcode_img_content: 'https://qr.example/c' }),
      () => ({ status: 'expired' }),
      () => ({ qrcode: 'qr-d', qrcode_img_content: 'https://qr.example/d' }),
      () => ({ status: 'expired' }),
    ]);
    const service = new BindingService({
      dataDir,
      client: () => client,
      pollIntervalMs: 1,
      maxQrRefreshes: 3,
      sleepFn: async () => {},
    });
    const start = await service.start();
    await service.waitSettled(start.sessionId);
    const status = service.getStatus(start.sessionId);
    expect(status.status).toBe('expired');
    expect(status.error).toContain('多次过期');
  });

  it('scaned_but_redirect：轮询基座切到 redirect_host', async () => {
    dataDir = await setupTestDataDir();
    const { client, calls } = scriptedFetch([
      () => ({ qrcode: 'qr-5', qrcode_img_content: 'https://qr.example/5' }),
      () => ({ status: 'scaned_but_redirect', redirect_host: 'idc2.weixin.qq.com' }),
      () => CONFIRMED,
    ]);
    const service = new BindingService({
      dataDir,
      client: () => client,
      pollIntervalMs: 1,
      sleepFn: async () => {},
    });
    const start = await service.start();
    await service.waitSettled(start.sessionId);
    expect(service.getStatus(start.sessionId).status).toBe('confirmed');
    // 第三次调用（确认轮询）应打到 https://idc2.weixin.qq.com
    expect(calls[2]!.url).toContain('https://idc2.weixin.qq.com/ilink/bot/get_qrcode_status');
  });

  it('网络错误视为 wait 继续轮询；need_verifycode → error 明确反馈', async () => {
    dataDir = await setupTestDataDir();
    let n = 0;
    const { client } = mockIlinkClient(() => {
      n++;
      if (n === 1) return { qrcode: 'qr-n', qrcode_img_content: 'https://qr.example/n' };
      if (n <= 3) throw new Error('ECONNRESET: connection reset');
      return { status: 'need_verifycode' };
    });
    const service = new BindingService({
      dataDir,
      client: () => client,
      pollIntervalMs: 1,
      sessionTtlMs: 60_000,
      sleepFn: async () => {},
    });
    const start = await service.start();
    await service.waitSettled(start.sessionId);
    const status = service.getStatus(start.sessionId);
    expect(status.status).toBe('error');
    expect(status.error).toContain('验证码');
  });
});

describe('onboarding 幂等', () => {
  let dataDir: string;

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('重复 provision（并发/回调重放）→ 不重复建租户/宠物', async () => {
    dataDir = await setupTestDataDir();
    const first = await provisionWechatTenant(dataDir, CONFIRMED as never);
    const second = await provisionWechatTenant(dataDir, CONFIRMED as never);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    const db = await getDb(dataDir);
    expect((await db.select().from(tenants).all()).length).toBe(1);
    expect((await db.select().from(pets).all()).length).toBe(1);
  });
});
