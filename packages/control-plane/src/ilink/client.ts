/**
 * iLink（微信 ClawBot）HTTP 客户端（#97，自研薄适配器）
 *
 * 9 个端点（基座默认 https://ilinkai.weixin.qq.com，带 /ilink/bot/ 前缀）：
 *   get_bot_qrcode / get_qrcode_status / getupdates（长轮询收消息）/
 *   sendmessage（主动推送 + 回复）/ getconfig / sendtyping /
 *   getuploadurl / CDN upload / CDN download（媒体，首版文本后置）
 *
 * 参考：Tencent/openclaw-weixin（官方，字段/头/错误处理）+ hermes weixin.py
 * （-2/-14 语义）。⚠️ 本机无法真实扫码联调——接入生产前按"部署后验证项"
 * 用真实 bot_token 过一遍端点（错误码/头字段以真实响应为准）。
 *
 * 错误语义（本模块核心）：
 * - ret=-2 且 errmsg=='unknown error' → 会话失效（等同 -14）→ 需重新激活
 * - ret=-2 其他 → 限流 → 3× 指数退避重试（base ×3^i）
 * - errcode=-14 → 会话过期
 *
 * mock 友好：baseUrl / fetchFn / sleepFn 全部可注入（测试用假 fetch 端点）。
 */

import { randomBytes, randomUUID } from 'crypto';
import {
  type IlinkGetConfigResp,
  type IlinkGetUpdatesResp,
  type IlinkGetUploadUrlReq,
  type IlinkGetUploadUrlResp,
  type IlinkQrStartResp,
  type IlinkQrStatusResp,
  type IlinkSendMessageReq,
  type IlinkSendMessageResp,
  type IlinkSendTypingReq,
  type IlinkSendTypingResp,
} from './types.js';

/** 默认基座（confirmed 的 baseurl 优先；scaned_but_redirect 后切 host） */
export const ILINK_DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';

/** 分块发送默认块大小（hermes 保守值；openclaw 用 4000——留余量取 2000） */
export const DEFAULT_CHUNK_SIZE = 2000;
/** 分块间默认延时（ms；防风控连发） */
export const DEFAULT_CHUNK_DELAY_MS = 1500;

/** 限流退避重试次数（"3× 指数退避" = 初始失败后最多再试 3 次） */
const DEFAULT_RATE_LIMIT_RETRIES = 3;
/** 限流退避基数（ms；退避 = base × 3^i） */
const DEFAULT_RATE_LIMIT_BACKOFF_BASE_MS = 1_000;

/** 长轮询默认超时（服务端 hold 约 35s） */
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
/** 普通请求默认超时 */
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

// ─── 错误类型（按 ret/errcode 分类，调用方据此决策） ───────────────────

export class IlinkError extends Error {
  constructor(
    message: string,
    readonly ret?: number,
    readonly errmsg?: string,
  ) {
    super(message);
    this.name = 'IlinkError';
  }
}

/** ret=-2 + 'unknown error'（或 -14）：会话失效 → 需主人重新发消息激活 */
export class IlinkSessionInvalidError extends IlinkError {
  constructor(ret: number | undefined, errmsg: string | undefined) {
    super(`iLink 会话失效（ret=${ret} errmsg=${errmsg ?? 'unknown'}），需重新激活`, ret, errmsg);
    this.name = 'IlinkSessionInvalidError';
  }
}

/** ret=-2（其他 errmsg）：限流（重试耗尽后抛出） */
export class IlinkRateLimitError extends IlinkError {
  constructor(ret: number | undefined, errmsg: string | undefined) {
    super(`iLink 限流（ret=${ret} errmsg=${errmsg ?? 'unknown'}），请退避后重试`, ret, errmsg);
    this.name = 'IlinkRateLimitError';
  }
}

/** 其他 ret != 0 */
export class IlinkApiError extends IlinkError {
  constructor(message: string, ret: number | undefined, errmsg: string | undefined) {
    super(message, ret, errmsg);
    this.name = 'IlinkApiError';
  }
}

/** 网络层失败（fetch 抛错/超时/非 2xx） */
export class IlinkNetworkError extends IlinkError {
  constructor(message: string) {
    super(message);
    this.name = 'IlinkNetworkError';
  }
}

// ─── 客户端选项 ─────────────────────────────────────────────────────────

export interface IlinkClientOptions {
  /** 基座 URL（confirmed 的 baseurl；测试注入 mock 基座） */
  baseUrl: string;
  /** bot_token（Bearer；get_bot_qrcode/get_qrcode_status 阶段可缺省） */
  botToken?: string;
  /** 注入式 fetch（测试）；缺省全局 fetch */
  fetchFn?: typeof fetch;
  /** 注入式 sleep（测试）；缺省 setTimeout 包装 */
  sleepFn?: (ms: number) => Promise<void>;
  /** 限流重试次数（默认 3：初始失败后再试 3 次，共 4 次尝试） */
  rateLimitRetries?: number;
  /** 限流退避基数 ms（默认 1000；退避 = base × 3^i） */
  rateLimitBackoffBaseMs?: number;
  /** 长轮询超时 ms（getUpdates/get_qrcode_status，默认 35000） */
  longPollTimeoutMs?: number;
  /** 普通请求超时 ms（默认 15000） */
  requestTimeoutMs?: number;
  /** 分块发送块间延时 ms（默认 1500；测试 0） */
  chunkDelayMs?: number;
  /** 分块上限字符数（默认 2000） */
  chunkSize?: number;
}

/** fetch 响应解析结果 */
interface ParsedJson {
  ok: boolean;
  status: number;
  text: string;
  json: unknown;
}

// ─── 工具函数 ───────────────────────────────────────────────────────────

/** X-WECHAT-UIN：随机 uint32 → 十进制 → base64（每次请求随机） */
export function randomWechatUin(): string {
  const uint32 = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf-8').toString('base64');
}

/**
 * 按自然边界分块（纯函数，可测）：段落 → 行 → 空格 → 硬切。
 * 按 Unicode 字符计（[...str]），CJK/emoji 不截断代理对。
 */
export function chunkText(text: string, maxChars = DEFAULT_CHUNK_SIZE): string[] {
  const chars = [...text];
  if (chars.length <= maxChars) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (chars.length - start > maxChars) {
    const head = chars.slice(start, start + maxChars);
    const lastNl = head.lastIndexOf('\n');
    const lastSpace = head.lastIndexOf(' ');
    let cut = head.length;
    // 自然边界阈值：避免切出碎片级小块（<40% 窗口时放弃该边界硬切）。
    // 分隔符归前块（cut = 边界 + 1），后块从干净内容开始。
    if (lastNl > maxChars * 0.4) cut = lastNl + 1;
    else if (lastSpace > maxChars * 0.4) cut = lastSpace + 1;
    chunks.push(head.slice(0, cut).join(''));
    start += cut;
  }
  chunks.push(chars.slice(start).join(''));
  return chunks;
}

/** 消息里的文本内容（item_list 首个文本项；非文本消息返回 null） */
export function extractTextFromMessage(
  msg: { item_list?: { type?: number; text_item?: { text?: string } }[] },
): string | null {
  for (const item of msg.item_list ?? []) {
    if (item.type === 1 && typeof item.text_item?.text === 'string' && item.text_item.text) {
      return item.text_item.text;
    }
  }
  return null;
}

/**
 * 对响应做 ret/errcode 分类。返回 null = 成功；否则抛对应错误。
 * 双语义核心：ret=-2 必须看 errmsg——'unknown error' = 会话失效，否则限流。
 */
export function assertSuccess(ret: number | undefined, errmsg: string | undefined): void {
  if (ret === undefined || ret === 0) return;
  if (ret === -14) {
    throw new IlinkSessionInvalidError(ret, errmsg);
  }
  if (ret === -2) {
    if (errmsg === 'unknown error') {
      throw new IlinkSessionInvalidError(ret, errmsg);
    }
    throw new IlinkRateLimitError(ret, errmsg);
  }
  throw new IlinkApiError(`iLink 返回错误 ret=${ret}`, ret, errmsg);
}

// ─── 客户端 ─────────────────────────────────────────────────────────────

export class IlinkClient {
  readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly rateLimitRetries: number;
  private readonly rateLimitBackoffBaseMs: number;
  private readonly longPollTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly chunkDelayMs: number;
  private readonly chunkSize: number;

  constructor(options: IlinkClientOptions) {
    this.baseUrl = options.baseUrl;
    this.token = options.botToken;
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleepFn =
      options.sleepFn ??
      ((ms) => {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, ms);
        return promise;
      });
    this.rateLimitRetries = options.rateLimitRetries ?? DEFAULT_RATE_LIMIT_RETRIES;
    this.rateLimitBackoffBaseMs = options.rateLimitBackoffBaseMs ?? DEFAULT_RATE_LIMIT_BACKOFF_BASE_MS;
    this.longPollTimeoutMs = options.longPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.chunkDelayMs = options.chunkDelayMs ?? DEFAULT_CHUNK_DELAY_MS;
    this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  }

  /** 换 bot_token 生成新实例（重扫后 binding 更新） */
  withToken(botToken: string): IlinkClient {
    return new IlinkClient({
      baseUrl: this.baseUrl,
      botToken,
      fetchFn: this.fetchFn,
      sleepFn: this.sleepFn,
      rateLimitRetries: this.rateLimitRetries,
      rateLimitBackoffBaseMs: this.rateLimitBackoffBaseMs,
      longPollTimeoutMs: this.longPollTimeoutMs,
      requestTimeoutMs: this.requestTimeoutMs,
      chunkDelayMs: this.chunkDelayMs,
      chunkSize: this.chunkSize,
    });
  }

  // ─── 1. 获取二维码（无 token；body 可带 local_token_list 多设备） ──
  async getBotQrcode(opts: { botType?: string; localTokenList?: string[] } = {}): Promise<IlinkQrStartResp> {
    const botType = opts.botType ?? '3';
    const body = { local_token_list: opts.localTokenList ?? [] };
    const { json } = await this.request(
      `${this.baseUrl}/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
      { method: 'POST', body },
      { timeoutMs: this.requestTimeoutMs, token: undefined },
    );
    const resp = json as IlinkQrStartResp;
    if (!resp.qrcode || !resp.qrcode_img_content) {
      throw new IlinkApiError('get_bot_qrcode 响应缺少 qrcode/qrcode_img_content', undefined, undefined);
    }
    return resp;
  }

  // ─── 2. 轮询扫码状态（服务端 hold 约 35s 长轮询） ────────────────
  async getQrcodeStatus(
    qrcode: string,
    opts: { verifyCode?: string; baseUrlOverride?: string } = {},
  ): Promise<IlinkQrStatusResp> {
    let endpoint = `${opts.baseUrlOverride ?? this.baseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
    if (opts.verifyCode) endpoint += `&verify_code=${encodeURIComponent(opts.verifyCode)}`;
    const { json } = await this.request(endpoint, { method: 'GET' }, { timeoutMs: this.longPollTimeoutMs, token: undefined });
    const resp = json as IlinkQrStatusResp;
    // P3 修复：状态轮询同样按 ret/errcode 分类——ret=-2 限流抛 IlinkRateLimitError
    // （调用方退避继续），-14/unknown error 抛会话失效，不再被当作 wait 空转
    const errcode = resp.errcode ?? resp.ret;
    if (errcode !== undefined && errcode !== 0) {
      assertSuccess(errcode, resp.errmsg);
    }
    return resp;
  }

  // ─── 3. 长轮询收消息（游标 get_updates_buf 原样带回） ─────────────
  async getUpdates(opts: { getUpdatesBuf?: string; longPollTimeoutMs?: number } = {}): Promise<IlinkGetUpdatesResp> {
    const body = { base_info: this.baseInfo(), get_updates_buf: opts.getUpdatesBuf ?? '' };
    const timeoutMs = opts.longPollTimeoutMs ?? this.longPollTimeoutMs;
    const { json } = await this.request(
      `${this.baseUrl}/ilink/bot/getupdates`,
      { method: 'POST', body },
      { timeoutMs },
    );
    const resp = json as IlinkGetUpdatesResp;
    // 长轮询也可能带错误码（-2 限流 / -14 会话过期）——与 sendmessage 同分类
    const errcode = resp.errcode ?? resp.ret;
    if (errcode !== undefined && errcode !== 0) {
      assertSuccess(errcode, resp.errmsg);
    }
    return resp;
  }

  // ─── 4. 发送文本（主动推送 + 回复）；限流 3× 指数退避 ────────────
  async sendMessage(
    toUserId: string,
    text: string,
    opts: { contextToken?: string; clientId?: string } = {},
  ): Promise<void> {
    const clientId = opts.clientId ?? randomUUID();
    const req: IlinkSendMessageReq = {
      msg: {
        from_user_id: '',
        to_user_id: toUserId,
        client_id: clientId,
        message_type: 2, // BOT
        message_state: 2, // FINISH
        item_list: [{ type: 1, text_item: { text } }],
        ...(opts.contextToken ? { context_token: opts.contextToken } : {}),
      },
    };

    let lastRateLimit: IlinkRateLimitError | null = null;
    // 尝试次数 = 1 + rateLimitRetries（"3× 指数退避"：初始失败后再退避重试 3 次）
    for (let attempt = 0; attempt <= this.rateLimitRetries; attempt++) {
      try {
        const { json } = await this.request(
          `${this.baseUrl}/ilink/bot/sendmessage`,
          { method: 'POST', body: req },
          { timeoutMs: this.requestTimeoutMs },
        );
        // HTTP 200 空 body 或 {} 即成功；有 ret 时按 ret 判定
        const resp = (json ?? {}) as IlinkSendMessageResp;
        assertSuccess(resp.ret, resp.errmsg);
        return;
      } catch (error) {
        if (error instanceof IlinkRateLimitError) {
          lastRateLimit = error;
          // 只在还有后续重试时退避（最后一次失败直接抛）
          if (attempt >= this.rateLimitRetries) break;
          const backoffMs = this.rateLimitBackoffBaseMs * 3 ** attempt;
          await this.sleepFn(backoffMs);
          continue;
        }
        // 会话失效/其他错误不重试（重扫或人工介入）
        throw error;
      }
    }
    throw lastRateLimit ?? new IlinkRateLimitError(-2, 'rate limit');
  }

  // ─── 5. getconfig（typing_ticket） ─────────────────────────────────
  async getConfig(): Promise<IlinkGetConfigResp> {
    const { json } = await this.request(
      `${this.baseUrl}/ilink/bot/getconfig`,
      { method: 'POST', body: { base_info: this.baseInfo() } },
      { timeoutMs: this.requestTimeoutMs },
    );
    const resp = json as IlinkGetConfigResp;
    assertSuccess(resp.ret, resp.errmsg);
    return resp;
  }

  // ─── 6. sendtyping（打字指示） ─────────────────────────────────────
  async sendTyping(req: IlinkSendTypingReq): Promise<void> {
    const { json } = await this.request(
      `${this.baseUrl}/ilink/bot/sendtyping`,
      { method: 'POST', body: { base_info: this.baseInfo(), ...req } },
      { timeoutMs: this.requestTimeoutMs },
    );
    const resp = json as IlinkSendTypingResp;
    assertSuccess(resp.ret, resp.errmsg);
  }

  // ─── 7. getuploadurl（媒体上传参数；首版文本后置） ────────────────
  async getUploadUrl(req: IlinkGetUploadUrlReq): Promise<IlinkGetUploadUrlResp> {
    const { json } = await this.request(
      `${this.baseUrl}/ilink/bot/getuploadurl`,
      { method: 'POST', body: { base_info: this.baseInfo(), ...req } },
      { timeoutMs: this.requestTimeoutMs },
    );
    const resp = json as IlinkGetUploadUrlResp;
    assertSuccess(resp.ret, resp.errmsg);
    return resp;
  }

  // ─── 8. CDN upload（AES-128-ECB 加密体；首版后置，仅端点封装） ────
  async uploadCdn(uploadUrl: string, param: string, body: BodyInit): Promise<void> {
    const { status } = await this.request(uploadUrl, {
      method: 'POST',
      headers: { 'x-encrypted-param': param },
      body,
    }, { timeoutMs: this.requestTimeoutMs, token: undefined, parseJson: false });
    if (status < 200 || status >= 300) {
      throw new IlinkNetworkError(`CDN upload HTTP ${status}`);
    }
  }

  // ─── 9. CDN download（首版后置，仅端点封装） ───────────────────────
  async downloadCdn(downloadUrl: string): Promise<Response> {
    return this.fetchFn(downloadUrl, { signal: AbortSignal.timeout(this.requestTimeoutMs) });
  }

  // ─── 分块发送：>chunkSize 按自然边界分块 + 块间延时 ───────────────
  async sendTextChunked(
    toUserId: string,
    text: string,
    opts: { contextToken?: string } = {},
  ): Promise<string[]> {
    const chunks = chunkText(text, this.chunkSize);
    const clientIds: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;
      const clientId = randomUUID();
      await this.sendMessage(toUserId, chunk, { contextToken: opts.contextToken, clientId });
      clientIds.push(clientId);
      if (i < chunks.length - 1 && this.chunkDelayMs > 0) {
        await this.sleepFn(this.chunkDelayMs);
      }
    }
    return clientIds;
  }

  // ─── 内部 ──────────────────────────────────────────────────────────

  private baseInfo(): { channel_version: string; bot_agent: string } {
    return { channel_version: '2.0.0', bot_agent: 'cyber-stray' };
  }

  private headers(token?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      AuthorizationType: 'ilink_bot_token',
      'X-WECHAT-UIN': randomWechatUin(),
      'iLink-App-Id': 'cyber-stray',
      'iLink-App-ClientVersion': '1',
    };
    const effectiveToken = token ?? this.token;
    if (effectiveToken) {
      headers.Authorization = `Bearer ${effectiveToken}`;
    }
    return headers;
  }

  /**
   * 统一请求入口：构建头 → fetch → 非 2xx 抛 IlinkNetworkError → JSON 解析。
   * 注入 fetchFn 的测试由此断言 URL/头/body。
   */
  private async request(
    url: string,
    init: { method: string; body?: unknown; headers?: Record<string, string> },
    opts: { timeoutMs: number; token?: string; parseJson?: boolean },
  ): Promise<ParsedJson> {
    const parseJson = opts.parseJson ?? true;
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: init.method,
        headers: { ...this.headers(opts.token), ...init.headers },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new IlinkNetworkError(`iLink 请求超时（${opts.timeoutMs}ms）`);
      }
      throw new IlinkNetworkError(`iLink 网络错误: ${message}`);
    }
    if (!response.ok) {
      throw new IlinkNetworkError(`iLink HTTP ${response.status} ${response.statusText}`);
    }
    if (!parseJson) {
      return { ok: true, status: response.status, text: '', json: null };
    }
    const text = await response.text();
    let json: unknown = null;
    if (text.trim()) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        // sendmessage 成功可能返回空 body 或非 JSON——视为成功（ret 缺失）
      }
    }
    return { ok: response.ok, status: response.status, text, json };
  }
}
