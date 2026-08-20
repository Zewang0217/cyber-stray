/**
 * 微信长轮询 + 互动闭环测试（#97）
 *
 * 契约（激活/保鲜/互动）：
 * - paired（已绑定未激活）：主人第一条消息 → 激活 → 宠物打招呼自我介绍，
 *   不发 LLM；非主人消息忽略（pairing 白名单）
 * - active：主人回复 → spawn 短命 agent（mock LLM）→ 回复微信；聊天历史
 *   跨次保留（user/bot 都落租户目录）
 * - expired（24h 无交互 / 发送遇会话失效）：主人再发消息 → 重新激活 + 打招呼
 * - 24h 保鲜：active 且 lastInteractionAt 超 24h → 轮询主动翻 expired
 * - 游标 get_updates_buf 持久化；context_token 缓存最新
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { rmSync } from 'fs';
import { getDb, _resetDb } from '../db/client.js';
import { eq } from 'drizzle-orm';
import { wechatBindings } from '../db/schema.js';
import { provisionWechatTenant, getBinding } from './bindings.js';
import { readChatHistory, readContextToken } from './chat-history.js';
import { WechatPoller } from './poller.js';
import { mockIlinkClient, sentMessages, setupTestDataDir } from './test-helpers.js';
import type { ReplySpawn } from './reply.js';

const CONFIRMED = {
  status: 'confirmed',
  bot_token: 'v1_bot_token',
  ilink_bot_id: 'bot123@im.bot',
  baseurl: 'https://ilinkai.weixin.qq.com',
  ilink_user_id: 'owner@im.wechat',
} as const;

const OWNER = 'owner@im.wechat';

/** 假 LLM：spawnFn 直接返回固定回复 */
function fakeSpawn(reply: string): ReplySpawn {
  return async () => ({ exitCode: 0, stdout: JSON.stringify({ ok: true, reply }) });
}

/** URL 分支 responder：getupdates → msgs；sendmessage → 成功 */
function updatesResponder(msgs: unknown[], cursor?: string) {
  return (url: string) =>
    url.includes('/getupdates')
      ? { msgs, ...(cursor ? { get_updates_buf: cursor } : {}) }
      : { ret: 0 };
}

describe('微信互动闭环', () => {
  let dataDir: string;

  afterEach(() => {
    _resetDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  /** 建已绑定租户（status paired） */
  async function seedPairedBinding(): Promise<string> {
    dataDir = await setupTestDataDir();
    const result = await provisionWechatTenant(dataDir, CONFIRMED as never);
    return result.tenantId;
  }

  it('paired → 主人首条消息激活 + 打招呼（不发 LLM）；非主人消息忽略', async () => {
    const tenantId = await seedPairedBinding();
    const { client, calls } = mockIlinkClient(
      updatesResponder(
        [
          {
            from_user_id: 'stranger@im.wechat',
            item_list: [{ type: 1, text_item: { text: '在吗' } }],
            context_token: 'ctx-x',
          },
          {
            from_user_id: OWNER,
            item_list: [{ type: 1, text_item: { text: '你好' } }],
            context_token: 'ctx-1',
          },
        ],
        'cursor-1',
      ),
    );
    const spawn = vi.fn(fakeSpawn('LLM 回复')) as unknown as ReplySpawn;
    const poller = new WechatPoller({ dataDir, clientFactory: () => client, spawnFn: spawn });
    await poller.pollTenantOnce(tenantId);

    // 激活 + 打招呼
    const db = await getDb(dataDir);
    const binding = await getBinding(db, tenantId);
    expect(binding?.status).toBe('active');
    expect(binding?.lastInteractionAt).toBeTruthy();
    // 只有主人消息触发发送（打招呼）；非主人被白名单忽略
    const sent = sentMessages(calls);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(OWNER);
    expect(sent[0]!.text).toContain('街溜子');
    // 激活只打招呼，不 spawn LLM
    expect(spawn).not.toHaveBeenCalled();
    // context_token 缓存最新（非主人的 ctx-x 未缓存）
    expect(await readContextToken(dataDir, tenantId, OWNER)).toBe('ctx-1');
    expect(await readContextToken(dataDir, tenantId, 'stranger@im.wechat')).toBeNull();
    // 游标持久化
    expect(binding?.getUpdatesBuf).toBe('cursor-1');
    // 聊天历史跨次保留（user 行）
    const history = await readChatHistory(dataDir, tenantId, OWNER, 20);
    expect(history.some((l) => l.role === 'user' && l.text === '你好')).toBe(true);
    expect(history.some((l) => l.role === 'bot' && l.text.includes('街溜子'))).toBe(true);
  });

  it('active → 主人回复 spawn LLM（带消息上下文）→ 回复微信 + 历史追加', async () => {
    const tenantId = await seedPairedBinding();
    // 直接置 active（模拟已激活）
    const db = await getDb(dataDir);
    await db
      .update(wechatBindings)
      .set({ status: 'active', lastInteractionAt: Date.now() })
      .where(eq(wechatBindings.tenantId, tenantId))
      .run();

    const { client, calls } = mockIlinkClient(
      updatesResponder(
        [
          {
            from_user_id: OWNER,
            item_list: [{ type: 1, text_item: { text: '最近在干嘛' } }],
            context_token: 'ctx-2',
          },
        ],
        'c1',
      ),
    );
    const spawn = vi.fn(fakeSpawn('哈哈,我最近在研究量子纠缠!'));
    await new WechatPoller({ dataDir, clientFactory: () => client, spawnFn: spawn as unknown as ReplySpawn }).pollTenantOnce(tenantId);

    // LLM 被调用，参数含主人消息 + pet-name + data-dir
    expect(spawn).toHaveBeenCalledTimes(1);
    const args = spawn.mock.calls[0] as unknown as [string, string[]];
    const joined = args[1].join(' ');
    expect(joined).toContain('最近在干嘛');
    expect(joined).toContain('--pet-name');
    expect(joined).toContain('--data-dir');
    // 回复发送 + 历史追加
    const sent = sentMessages(calls);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toBe('哈哈,我最近在研究量子纠缠!');
    expect(sent[0]!.contextToken).toBe('ctx-2');
    const history = await readChatHistory(dataDir, tenantId, OWNER, 20);
    expect(history.some((l) => l.role === 'bot' && l.text.includes('量子纠缠'))).toBe(true);
  });

  it('expired → 主人再发消息 → 重新激活 + 打招呼（重新打招呼激活）', async () => {
    const tenantId = await seedPairedBinding();
    // 先激活
    const { client: c1 } = mockIlinkClient(updatesResponder([]));
    await new WechatPoller({ dataDir, clientFactory: () => c1 }).pollTenantOnce(tenantId);

    // 强制翻 expired（模拟 24h 无交互 或 发送遇会话失效）
    const db = await getDb(dataDir);
    await db
      .update(wechatBindings)
      .set({ status: 'expired', lastInteractionAt: null })
      .where(eq(wechatBindings.tenantId, tenantId))
      .run();

    const { client, calls } = mockIlinkClient(
      updatesResponder([
        {
          from_user_id: OWNER,
          item_list: [{ type: 1, text_item: { text: '在吗?' } }],
          context_token: 'ctx-3',
        },
      ]),
    );
    const spawn = vi.fn(fakeSpawn('不应被调用')) as unknown as ReplySpawn;
    await new WechatPoller({ dataDir, clientFactory: () => client, spawnFn: spawn }).pollTenantOnce(tenantId);

    const binding = await getBinding(db, tenantId);
    expect(binding?.status).toBe('active'); // 重新激活
    const sent = sentMessages(calls);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('街溜子'); // 打招呼
    expect(spawn).not.toHaveBeenCalled(); // 重新激活不发 LLM
  });

  it('24h 保鲜：active 且超 24h 无交互 → 轮询主动翻 expired（不再拉取/处理）', async () => {
    const tenantId = await seedPairedBinding();
    const db = await getDb(dataDir);
    const stale = Date.now() - 25 * 60 * 60 * 1000;
    await db
      .update(wechatBindings)
      .set({ status: 'active', lastInteractionAt: stale })
      .where(eq(wechatBindings.tenantId, tenantId))
      .run();

    const { client, calls } = mockIlinkClient(updatesResponder([]));
    await new WechatPoller({ dataDir, clientFactory: () => client }).pollTenantOnce(tenantId);

    const binding = await getBinding(db, tenantId);
    expect(binding?.status).toBe('expired');
    // 未发起 getupdates（保鲜判定在拉取前）
    expect(calls).toHaveLength(0);
  });

  it('回复 worker 失败（exit 非 0）→ 不发送，绑定记 lastError', async () => {
    const tenantId = await seedPairedBinding();
    const db = await getDb(dataDir);
    await db
      .update(wechatBindings)
      .set({ status: 'active', lastInteractionAt: Date.now() })
      .where(eq(wechatBindings.tenantId, tenantId))
      .run();

    const { client, calls } = mockIlinkClient(
      updatesResponder([
        {
          from_user_id: OWNER,
          item_list: [{ type: 1, text_item: { text: 'hi' } }],
          context_token: 'ctx-4',
        },
      ]),
    );
    const spawn = (async () => ({ exitCode: 1, stdout: 'boom' })) as unknown as ReplySpawn;
    await new WechatPoller({ dataDir, clientFactory: () => client, spawnFn: spawn }).pollTenantOnce(tenantId);

    // 不发送回复
    expect(sentMessages(calls)).toHaveLength(0);
    const db2 = await getDb(dataDir);
    const binding2 = await getBinding(db2, tenantId);
    expect(binding2?.lastError).toContain('退出码');
  });
});
