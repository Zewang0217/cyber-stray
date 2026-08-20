/**
 * 微信聊天历史 + context_token 缓存（#97）
 *
 * 存租户目录（dataDir/tenants/<id>/wechat/），与 agent 的 markdown 记忆层
 * 同域——CP 是唯一写者（收消息落 user 行、回复落 bot 行），短命 agent
 * 进程只读历史做上下文。文件按用户隔离（pairing 白名单下恒为单主人）。
 *
 * context_token：每条入站消息携带、2 分钟级轮换的短命凭证；回复必须用
 * 最新 token（sendmessage 原样回传）。跨重启持久化（24h 有效会话）。
 */

import { appendFile, mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

/** 微信数据子目录（租户目录下） */
export function wechatDataDir(dataDir: string, tenantId: string): string {
  return join(dataDir, 'tenants', tenantId, 'wechat');
}

/** 用户 id 作文件名安全化（ilink_user_id 形如 'hex@im.wechat'） */
export function safeUserId(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export interface ChatLine {
  role: 'user' | 'bot';
  text: string;
  at: string;
}

/** 追加一条聊天记录（目录自动创建） */
export async function appendChatLine(
  dataDir: string,
  tenantId: string,
  userId: string,
  line: ChatLine,
): Promise<void> {
  const dir = wechatDataDir(dataDir, tenantId);
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, `chat-${safeUserId(userId)}.jsonl`), `${JSON.stringify(line)}\n`, 'utf8');
}

/** 读最近 N 条聊天记录（尾部倒序；文件缺失 = 空历史） */
export async function readChatHistory(
  dataDir: string,
  tenantId: string,
  userId: string,
  limit = 10,
): Promise<ChatLine[]> {
  const file = join(wechatDataDir(dataDir, tenantId), `chat-${safeUserId(userId)}.jsonl`);
  let content: string;
  try {
    content = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const lines = content.split('\n').filter(Boolean).slice(-limit);
  const out: ChatLine[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as ChatLine;
      if (parsed && typeof parsed.text === 'string') out.push(parsed);
    } catch {
      // 单行损坏跳过（不阻断读取）
    }
  }
  return out;
}

// ─── context_token 缓存（按用户最新 token；跨重启持久化） ──────────────

interface ContextTokenCache {
  [userId: string]: string;
}

const TOKENS_FILE = 'context-tokens.json';

/** 缓存最新 context_token（2 分钟级轮换 → 恒用最新） */
export async function cacheContextToken(
  dataDir: string,
  tenantId: string,
  userId: string,
  token: string,
): Promise<void> {
  const dir = wechatDataDir(dataDir, tenantId);
  await mkdir(dir, { recursive: true });
  const cache = await readContextTokens(dataDir, tenantId);
  cache[userId] = token;
  await writeTokensFile(dir, cache);
}

/** 读某用户最新 context_token；无则 null */
export async function readContextToken(
  dataDir: string,
  tenantId: string,
  userId: string,
): Promise<string | null> {
  const cache = await readContextTokens(dataDir, tenantId);
  return cache[userId] ?? null;
}

async function readContextTokens(dataDir: string, tenantId: string): Promise<ContextTokenCache> {
  const file = join(wechatDataDir(dataDir, tenantId), TOKENS_FILE);
  try {
    return JSON.parse(await readFile(file, 'utf8')) as ContextTokenCache;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    // JSON 损坏：视为空缓存（token 短命，丢一条可自愈）
    return {};
  }
}

async function writeTokensFile(dir: string, cache: ContextTokenCache): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, TOKENS_FILE), JSON.stringify(cache, null, 2), 'utf8');
}
