/**
 * 微信长轮询器（#97）：每租户一条独立 getupdates 长轮询循环。
 *
 * 模型（ADR-0003 / ilink-research）：
 * - 每账号独立 poll 循环（hermes 实测 60 bot 无压力）；游标 get_updates_buf
 *   按绑定行持久化——重启先恢复再轮询，防重收/漏收。
 * - 收消息 → handleInboundMessage（激活/回复/白名单）；context_token 缓存
 *   按用户最新值（2 分钟级轮换）。
 * - 错误处理：会话失效（-2 unknown / -14）→ 标记 expired 停轮询（等主人
 *   重新打招呼激活）；限流 → 指数退避继续；24h 无交互 → 主动翻 expired。
 *
 * 单实例约束：与调度器同生命周期（index.ts 启动/优雅关停）。多机部署需
 * DB 级租约防游标互踩（见"部署后验证项"）。
 */

import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { wechatBindings } from '../db/schema.js';
import {
  getBinding,
  isWechatSessionExpired,
  readBotToken,
  updateBinding,
} from './bindings.js';
import { IlinkRateLimitError, IlinkSessionInvalidError, type IlinkClient } from './client.js';
import { handleInboundMessage, handleSendFailure, type ReplySpawn } from './reply.js';
import type { IlinkMessage } from './types.js';

export interface WechatPollerDeps {
  /** 控制面数据根（租户目录 + S4 secrets） */
  dataDir: string;
  /** 按 (baseUrl, botToken) 建客户端（测试注入 mock） */
  clientFactory: (baseUrl: string, botToken: string) => IlinkClient;
  /** 回复 worker spawn（测试注入 fake 模拟 LLM） */
  spawnFn?: ReplySpawn;
  command?: string;
  now?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
  /** 两轮长轮询之间间隔 ms（服务端本身 hold 35s；防空响应紧循环） */
  pollIntervalMs?: number;
  /** 轮询错误退避基数 ms */
  errorBackoffMs?: number;
  /** 轮询错误退避上限 ms */
  maxBackoffMs?: number;
}

/** 轮询错误退避上限（5 分钟，防无限膨胀） */
const MAX_BACKOFF_MS = 5 * 60 * 1000;

export class WechatPoller {
  private readonly loops = new Map<string, { active: boolean }>();
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private readonly deps: WechatPollerDeps;

  constructor(deps: WechatPollerDeps) {
    this.deps = deps;
  }

  /** 周期扫描 + 兜底拉起（自愈：循环异常退出后下个 tick 重新拉起） */
  start(intervalMs: number): void {
    this.stop();
    if (intervalMs <= 0) return;
    // P0 修复：stop() 置位了 stopped，启动前必须复位，否则在飞循环全部直接退出
    this.stopped = false;
    this.timer = setInterval(() => {
      this.runOnce().catch((error: unknown) => {
        console.error('[wechat-poller] tick 失败：', error instanceof Error ? error.message : error);
      });
    }, intervalMs);
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = undefined;
    // 标记在飞循环退出（下次迭代 self-check）
    for (const entry of this.loops.values()) entry.active = false;
  }

  /** 单次扫描：为每个可轮询租户启动独立循环（已启动的跳过） */
  async runOnce(): Promise<void> {
    const db = await getDb(this.deps.dataDir);
    const rows = await db.select().from(wechatBindings).all();
    for (const row of rows) {
      // 全部绑定态都拉起循环（expired 也要收"重新打招呼"激活信号）
      if (this.loops.has(row.tenantId)) continue;
      this.loops.set(row.tenantId, { active: true });
      void this.loop(row.tenantId).catch((error: unknown) => {
        console.error(`[wechat-poller] 循环异常退出（${row.tenantId}）：`, error);
      });
    }
  }

  /**
   * 单轮轮询（测试驱动：种子绑定后调用，断言处理结果）。
   * 返回本次处理的消息数；错误抛给调用方。
   */
  async pollTenantOnce(tenantId: string): Promise<number> {
    const { dataDir, clientFactory, spawnFn, command, now } = this.deps;
    const nowMs = now ?? Date.now;
    const db = await getDb(dataDir);
    const binding = await getBinding(db, tenantId);
    if (!binding) return 0;
    // 三种绑定态都轮询：expired 也必须收消息——主人"重新打招呼"就是激活信号
    // （失效的是 context_token 发送通道，getupdates 只依赖 bot_token）

    const token = await readBotToken(dataDir, tenantId);
    if (!token) return 0;
    const client = clientFactory(binding.baseUrl, token);

    // 保鲜维护：24h 无交互 → expired（主动翻，不等发送失败）
    if (isWechatSessionExpired(binding, nowMs())) {
      await updateBinding(db, tenantId, { status: 'expired' });
      return 0;
    }

    const resp = await client.getUpdates({ getUpdatesBuf: binding.getUpdatesBuf ?? undefined });
    if (resp.get_updates_buf) {
      await updateBinding(db, tenantId, { getUpdatesBuf: resp.get_updates_buf });
    }
    const msgs = resp.msgs ?? [];
    for (const message of msgs) {
      await this.processMessage({ tenantId, client, message });
    }
    return msgs.length;
  }

  /** 处理单条入站消息（发送失败分类记账，不中断整批） */
  private async processMessage(opts: {
    tenantId: string;
    client: IlinkClient;
    message: IlinkMessage;
  }): Promise<void> {
    const { dataDir, spawnFn, command, now } = this.deps;
    const db = await getDb(dataDir);
    // 处理前重读绑定（激活可能已翻转 status）
    const fresh = await getBinding(db, opts.tenantId);
    if (!fresh) return;
    try {
      await handleInboundMessage({
        dataDir,
        db,
        client: opts.client,
        binding: fresh,
        message: opts.message,
        spawnFn,
        command,
        now,
      });
    } catch (error) {
      await handleSendFailure(db, opts.tenantId, error);
    }
  }

  /** 每租户独立循环（runOnce 拉起；stop/异常/终态退出） */
  private async loop(tenantId: string): Promise<void> {
    const { dataDir, clientFactory, spawnFn, command, now, sleepFn } = this.deps;
    const sleep = sleepFn ?? ((ms: number) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, ms);
      return promise;
    });
    const pollIntervalMs = this.deps.pollIntervalMs ?? 1_000;
    const errorBackoffMs = this.deps.errorBackoffMs ?? 30_000;
    const maxBackoffMs = this.deps.maxBackoffMs ?? MAX_BACKOFF_MS;
    const nowMs = now ?? Date.now;
    let backoffMs = 0;

    // P1 修复：整个循环体包 try/finally——任何退出路径（break/异常/stop）
    // 都清理 loops 条目，防租户残留 {active:true} 永久停止（自愈失效）
    try {
      const entry = this.loops.get(tenantId);
      while (entry?.active && !this.stopped) {
        const db = await getDb(dataDir);
        const binding = await getBinding(db, tenantId);
        if (!binding) break; // 解绑 = 停轮询

        // 保鲜维护：24h 无交互 → expired（仍继续轮询等"重新打招呼"激活）
        if (isWechatSessionExpired(binding, nowMs())) {
          await updateBinding(db, tenantId, { status: 'expired' });
        }

        const token = await readBotToken(dataDir, tenantId);
        if (!token) break;
        const client = clientFactory(binding.baseUrl, token);

        try {
          const resp = await client.getUpdates({ getUpdatesBuf: binding.getUpdatesBuf ?? undefined });
          if (resp.get_updates_buf) {
            await updateBinding(db, tenantId, { getUpdatesBuf: resp.get_updates_buf });
          }
          for (const message of resp.msgs ?? []) {
            await this.processMessage({ tenantId, client, message });
          }
          backoffMs = 0;
        } catch (error) {
          if (error instanceof IlinkSessionInvalidError) {
            // bot_token 级失效：标记 expired + 长退避继续轮询（hermes：暂停
            // 10 分钟而非停死；主人重新打招呼可自愈）
            await updateBinding(db, tenantId, {
              status: 'expired',
              lastError: `轮询会话失效（${error.message}）`,
            });
            backoffMs = maxBackoffMs;
            await sleep(backoffMs);
            continue;
          }
          if (error instanceof IlinkRateLimitError) {
            backoffMs = backoffMs === 0 ? errorBackoffMs : Math.min(backoffMs * 3, maxBackoffMs);
            console.warn(`[wechat-poller] 限流退避 ${backoffMs}ms（${tenantId}）`);
          } else {
            backoffMs = errorBackoffMs;
            console.error(
              `[wechat-poller] 轮询错误（${tenantId}）：`,
              error instanceof Error ? error.message : error,
            );
          }
          await sleep(backoffMs);
          continue;
        }
        await sleep(pollIntervalMs);
      }
    } finally {
      this.loops.delete(tenantId);
    }
  }

  /** 在飞租户数（可观测/测试） */
  loopCount(): number {
    return this.loops.size;
  }
}
