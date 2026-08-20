/**
 * 微信绑定状态机（#97）：web 发起 → get_bot_qrcode → 后台轮询
 * get_qrcode_status → confirmed 落库（onboarding）→ 前端轮询状态。
 *
 * 状态：wait → scaned → confirmed | expired | error
 * 错误分支（明确反馈给前端）：
 * - 超时：QR 过期刷新 ≤3 次，总时长 8 分钟 → expired
 * - 他人扫码：scaned 观察到的身份 / 已绑定租户的主人身份 ≠ confirmed 的
 *   ilink_user_id → error（pairing 白名单防抢绑）
 * - need_verifycode / verify_code_blocked / binded_redirect → error
 * - scaned_but_redirect：轮询基座切到 https://<redirect_host>
 *
 * 会话存内存（单实例控制面；重启丢失 = 用户重新扫码，可接受）。confirmed
 * 后落库由 provisionWechatTenant 完成（租户/宠物/免费档/token/绑定行）。
 */

import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import {
  getBinding,
  provisionWechatTenant,
  type ProvisionResult,
} from './bindings.js';
import { ILINK_DEFAULT_BASE_URL, IlinkNetworkError, IlinkRateLimitError, type IlinkClient } from './client.js';
import type { IlinkQrStatusResp } from './types.js';

/** 轮询间隔（两次 get_qrcode_status 之间；服务端本身 hold 35s） */
const DEFAULT_POLL_INTERVAL_MS = 3_000;
/** 绑定会话总时长（openclaw：8 分钟，QR 过期最多刷新 3 次） */
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 1000;
/** QR 过期最大刷新次数 */
const DEFAULT_MAX_QR_REFRESHES = 3;
/** 会话终态后保留宽限（前端轮询确认读取；之后回收防内存无界） */
const SESSION_RETENTION_GRACE_MS = 60_000;
/** 并发绑定会话上限（防刷屏/打爆 iLink 额度） */
const DEFAULT_MAX_CONCURRENT_SESSIONS = 10;
/** 每来源发起限流（默认 5 次/10 分钟） */
const DEFAULT_START_RATE_LIMIT = { windowMs: 10 * 60_000, maxStarts: 5 } as const;

export type BindingSessionStatus =
  | 'wait'
  | 'scaned'
  | 'confirmed'
  | 'expired'
  | 'error'
  | 'not_found';

export interface BindingSession {
  id: string;
  qrcode: string;
  qrcodeImgUrl: string;
  startedAt: number;
  status: Exclude<BindingSessionStatus, 'not_found'>;
  scannedUserId?: string;
  currentBaseUrl: string;
  refreshCount: number;
  /** 已有绑定租户的主人身份（重扫防他人抢绑） */
  expectedOwnerId?: string;
  error?: string;
  result?: ProvisionResult;
}

export interface BindingServiceDeps {
  dataDir: string;
  /** 建客户端（get_bot_qrcode 阶段无 token；confirmed 后 provision 自行落库） */
  client: (baseUrl: string, botToken?: string) => IlinkClient;
  /** onboarding 落库（测试可注入） */
  provision?: typeof provisionWechatTenant;
  now?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  sessionTtlMs?: number;
  maxQrRefreshes?: number;
  /** 并发绑定会话上限（默认 10；防刷屏/打爆 iLink 额度） */
  maxConcurrentSessions?: number;
  /** 每来源发起限流（默认 5 次/10 分钟） */
  startRateLimit?: { windowMs: number; maxStarts: number };
}

export interface StartBindingResult {
  sessionId: string;
  qrcodeImgUrl: string;
  expiresAt: number;
}

/** 前端轮询视图（confirmed 带 result；not_found = 会话不存在/已清理） */
export interface BindingStatusView {
  status: BindingSessionStatus;
  sessionId?: string;
  qrcodeImgUrl?: string;
  expiresAt?: number;
  error?: string;
  result?: ProvisionResult;
}

export class BindingService {
  private readonly sessions = new Map<string, BindingSession>();
  private readonly settled = new Map<string, Promise<void>>();
  /** 每来源发起时间戳（限流滑窗） */
  private readonly startHistory = new Map<string, number[]>();
  private readonly deps: BindingServiceDeps;

  constructor(deps: BindingServiceDeps) {
    this.deps = deps;
  }

  /** 后台轮询循环结束的 promise（终态到达；测试/监控用） */
  waitSettled(sessionId: string): Promise<void> {
    const promise = this.settled.get(sessionId);
    if (!promise) return Promise.reject(new Error(`未知绑定会话 ${sessionId}`));
    return promise;
  }

  /**
   * 发起绑定：限流 + 并发上限 + 取二维码 + 启动后台状态轮询（fire-and-forget）。
   * clientKey 来自路由（x-forwarded-for；缺省 'unknown'）——公开端点防刷屏。
   */
  async start(tenantId?: string, clientKey = 'unknown'): Promise<StartBindingResult> {
    const { dataDir, client } = this.deps;
    const now = this.deps.now ?? Date.now;
    const nowMs = now();
    this.sweep(nowMs);

    // P1 限流：每来源滑窗内次数上限（公开端点防打爆 iLink 扫码额度）
    const limit = this.deps.startRateLimit ?? DEFAULT_START_RATE_LIMIT;
    const history = this.startHistory.get(clientKey) ?? [];
    const recent = history.filter((t) => nowMs - t < limit.windowMs);
    if (recent.length >= limit.maxStarts) {
      throw new Error('发起过于频繁,请稍后再试');
    }
    recent.push(nowMs);
    this.startHistory.set(clientKey, recent);
    if (this.sessions.size >= (this.deps.maxConcurrentSessions ?? DEFAULT_MAX_CONCURRENT_SESSIONS)) {
      throw new Error('当前绑定会话过多,请稍后再试');
    }

    const db = await getDb(dataDir);
    const existing = tenantId ? await getBinding(db, tenantId) : undefined;

    const ilink = client(ILINK_DEFAULT_BASE_URL);
    const resp = await ilink.getBotQrcode();

    const session: BindingSession = {
      id: randomUUID(),
      qrcode: resp.qrcode,
      qrcodeImgUrl: resp.qrcode_img_content,
      startedAt: nowMs,
      status: 'wait',
      currentBaseUrl: ILINK_DEFAULT_BASE_URL,
      refreshCount: 0,
      ...(existing ? { expectedOwnerId: existing.ilinkUserId } : {}),
    };
    this.sessions.set(session.id, session);
    const loop = this.runStatusLoop(session).catch((error: unknown) => {
      session.status = 'error';
      session.error = error instanceof Error ? error.message : String(error);
    });
    this.settled.set(session.id, loop);
    return { sessionId: session.id, qrcodeImgUrl: resp.qrcode_img_content, expiresAt: nowMs + (this.deps.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS) };
  }

  /**
   * 前端轮询状态（confirmed 返回 result；过期/错误返回明确原因）。
   * P2：手工构造视图只挑白名单字段——不泄露 qrcode 令牌/scannedUserId/
   * expectedOwnerId（主人微信身份）/currentBaseUrl/refreshCount。
   */
  getStatus(sessionId: string): BindingStatusView {
    const session = this.sessions.get(sessionId);
    if (!session) return { status: 'not_found' };
    const now = this.deps.now ?? Date.now;
    const ttl = this.deps.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    // 超时（ttl + 宽限）→ 回收会话，防内存无界
    if (now() - session.startedAt > ttl + SESSION_RETENTION_GRACE_MS) {
      this.evictSession(sessionId);
      return { status: 'not_found' };
    }
    // 只对进行中状态做读取侧过期判定；终态（expired/error/confirmed）不覆盖
    if (
      (session.status === 'wait' || session.status === 'scaned') &&
      now() - session.startedAt > ttl
    ) {
      session.status = 'expired';
      session.error = '二维码已过期,请重新生成';
    }
    return {
      status: session.status,
      sessionId: session.id,
      qrcodeImgUrl: session.qrcodeImgUrl,
      expiresAt: session.startedAt + ttl,
      ...(session.error ? { error: session.error } : {}),
      ...(session.result ? { result: session.result } : {}),
    };
  }

  /** 回收超龄会话（start/getStatus 时兜底清扫） */
  private sweep(nowMs: number): void {
    const ttl = this.deps.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    for (const [id, session] of this.sessions) {
      if (nowMs - session.startedAt > ttl + SESSION_RETENTION_GRACE_MS) {
        this.evictSession(id);
      }
    }
  }

  private evictSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.settled.delete(sessionId);
  }

  /** 后台轮询循环（start 拉起；终态/超时退出） */
  private async runStatusLoop(session: BindingSession): Promise<void> {
    const { dataDir, provision } = this.deps;
    const now = this.deps.now ?? Date.now;
    const sleep = this.deps.sleepFn ?? defaultSleep;
    const pollIntervalMs = this.deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const ttlMs = this.deps.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    const maxRefreshes = this.deps.maxQrRefreshes ?? DEFAULT_MAX_QR_REFRESHES;
    const provisionFn = provision ?? provisionWechatTenant;
    const ilink = this.deps.client(ILINK_DEFAULT_BASE_URL);

    while (now() - session.startedAt < ttlMs) {
      if (session.status === 'confirmed' || session.status === 'error' || session.status === 'expired') return;

      let resp: IlinkQrStatusResp;
      try {
        resp = await ilink.getQrcodeStatus(session.qrcode, { baseUrlOverride: session.currentBaseUrl });
      } catch (error) {
        // 网络/网关/限流错误视为 wait 继续轮询（openclaw 同策略；P3：ret=-2
        // 限流不再被当 wait 空转——客户端已分类，这里退避后继续）
        if (error instanceof IlinkNetworkError || error instanceof IlinkRateLimitError) {
          await sleep(pollIntervalMs * 3);
          continue;
        }
        throw error;
      }

      switch (resp.status) {
        case 'wait':
          break;
        case 'scaned':
          session.status = 'scaned';
          // 部分实现 scaned 即带扫码者身份；有则记录用于 confirmed 配对校验
          if (resp.ilink_user_id) session.scannedUserId = resp.ilink_user_id;
          break;
        case 'scaned_but_redirect':
          // 换 IDC：后续轮询切到 https://<host>
          if (resp.redirect_host) {
            session.currentBaseUrl = `https://${resp.redirect_host}`;
          }
          break;
        case 'need_verifycode':
          session.status = 'error';
          session.error = '该账号需要输入验证码(暂不支持),请稍后再试';
          return;
        case 'verify_code_blocked':
          session.status = 'error';
          session.error = '验证码输入受限,请稍后再试';
          return;
        case 'binded_redirect':
          session.status = 'error';
          session.error = '该微信已绑定其他 bot(一个微信号仅一个 bot 账号)';
          return;
        case 'expired': {
          if (session.refreshCount < maxRefreshes) {
            const refreshed = await ilink.getBotQrcode();
            session.qrcode = refreshed.qrcode;
            session.qrcodeImgUrl = refreshed.qrcode_img_content;
            session.refreshCount += 1;
            session.startedAt = now(); // 新 QR 重新计时
            session.status = 'wait';
            break;
          }
          session.status = 'expired';
          session.error = '二维码多次过期,请重新发起绑定';
          return;
        }
        case 'confirmed': {
          const pairingError = this.pairingError(session, resp);
          if (pairingError) {
            session.status = 'error';
            session.error = pairingError;
            return;
          }
          try {
            session.result = await provisionFn(dataDir, resp);
            session.status = 'confirmed';
          } catch (error) {
            session.status = 'error';
            session.error = `绑定确认失败: ${error instanceof Error ? error.message : String(error)}`;
          }
          return;
        }
      }
      await sleep(pollIntervalMs);
    }
    // 超时退出（全程 wait/scaned）
    if (session.status !== 'confirmed' && session.status !== 'error') {
      session.status = 'expired';
      session.error = '绑定超时,请重新发起';
    }
  }

  /**
   * pairing 白名单校验：防他人扫码抢绑。
   * - 新绑定：scaned 观察到的扫码者 ≠ confirmed 身份 → 拒绝
   * - 重扫（已绑定租户）：confirmed 身份 ≠ 租户既有主人 → 拒绝
   */
  private pairingError(session: BindingSession, resp: IlinkQrStatusResp): string | null {
    const confirmedOwner = resp.ilink_user_id;
    if (session.scannedUserId && confirmedOwner && session.scannedUserId !== confirmedOwner) {
      return '他人扫码:确认的微信身份与扫码者不一致,请重新生成二维码';
    }
    if (session.expectedOwnerId && confirmedOwner && session.expectedOwnerId !== confirmedOwner) {
      return '他人扫码:该租户已绑定其他微信身份,请用绑定时的微信重新扫码';
    }
    return null;
  }
}

function defaultSleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}
