/**
 * 微信互动处理（#97）：收 iLink 消息 → spawn 短命 agent 回复 → 发微信。
 *
 * 复用 feedback-cli 的 spawn 模式：CP 拉起
 * `bun agent/src/worker/wechat-reply-cli.ts --data-dir <dir> --user-id <id>
 *  --message <text> --pet-name <name> [--secrets-file <path>]`，
 * 捕获 stdout 一行 JSON（{ ok, reply }）。
 *
 * 激活/保鲜（ADR-0003）：
 * - paired（已绑定未激活）或 expired → 主人第一条消息 = 激活 → 发打招呼
 *   自我介绍（模板，确定性，不耗 LLM）；激活前不推内容。
 * - active → 正常 LLM 回复。
 * - pairing 白名单：非主人（from != ilink_user_id）的消息忽略。
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import type { ControlDb } from '../db/client.js';
import type { WechatBinding } from '../db/schema.js';
import { pets } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { openTenantSecrets } from '../secrets/tenant-secrets.js';
import { writeSecretsFile } from '../secrets/worker-secrets.js';
import { rm } from 'fs/promises';
import { updateBinding, isWechatSessionExpired } from './bindings.js';
import { appendChatLine, cacheContextToken, readContextToken } from './chat-history.js';
import { extractTextFromMessage, IlinkSessionInvalidError, type IlinkClient } from './client.js';
import type { IlinkMessage } from './types.js';

/** agent 微信回复 CLI 绝对路径（仓库内锚定，与 feedback-cli 同模式） */
const WECHAT_REPLY_CLI = fileURLToPath(
  new URL('../../../agent/src/worker/wechat-reply-cli.ts', import.meta.url),
);

/** 注入式 spawn（测试 fake）；捕获 stdout（CLI 输出一行 JSON 结果） */
export type ReplySpawn = (
  cmd: string,
  args: string[],
) => Promise<{ exitCode: number; stdout: string }>;

const realSpawn: ReplySpawn = (cmd, args) => {
  const { promise, resolve, reject } = Promise.withResolvers<{
    exitCode: number;
    stdout: string;
  }>();
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const out: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => out.push(chunk.toString('utf8')));
  const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
  child.on('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.on('exit', (code) => {
    clearTimeout(timer);
    resolve({ exitCode: code ?? -1, stdout: out.join('') });
  });
  return promise;
};

/** 打招呼模板（激活/重新激活时自我介绍；确定性，不耗 LLM） */
export function buildGreeting(petName: string): string {
  return (
    `你好呀!我是 ${petName},一只住在云端、靠好奇心到处逛的赛博街溜子。\n` +
    '你可以随时跟我说话——想聊什么都行,我最近正在研究各种新鲜事。'
  );
}

export interface ReplyHandlerDeps {
  dataDir: string;
  /** spawn 实现（测试注入 fake 模拟 LLM 回复） */
  spawnFn?: ReplySpawn;
  /** 命令（默认 env CP_WORKER_CMD，再退 'bun'） */
  command?: string;
  now?: () => number;
}

export interface InboundResult {
  /** 是否回复了微信 */
  replied: boolean;
  /** 本次是否触发激活（打招呼） */
  activated: boolean;
  reply?: string;
  ignored?: boolean;
}

/**
 * 处理一条入站消息（幂等入口：消息处理失败抛出，由 poller 记账重试）。
 * 返回结果供测试断言；发送失败抛错（不静默吞——上层记 lastError）。
 */
export async function handleInboundMessage(
  deps: ReplyHandlerDeps & {
    db: ControlDb;
    client: IlinkClient;
    binding: WechatBinding;
    message: IlinkMessage;
  },
): Promise<InboundResult> {
  const { dataDir, db, client, binding, message } = deps;
  const now = deps.now ?? Date.now;
  const from = message.from_user_id;
  if (!from) return { replied: false, activated: false, ignored: true };
  // pairing 白名单：非主人消息忽略（防他人搭话/滥用租户 bot）
  if (from !== binding.ilinkUserId) {
    return { replied: false, activated: false, ignored: true };
  }
  const text = extractTextFromMessage(message);
  if (!text) {
    // 非文本消息（图片/语音）：首版只做文本，忽略但留痕
    await appendChatLine(dataDir, binding.tenantId, from, {
      role: 'user',
      text: '[非文本消息]',
      at: new Date(now()).toISOString(),
    });
    return { replied: false, activated: false, ignored: true };
  }

  // 缓存最新 context_token（sendmessage 原样回传；短命轮换 → 恒用最新）
  if (message.context_token) {
    await cacheContextToken(dataDir, binding.tenantId, from, message.context_token);
  }
  await appendChatLine(dataDir, binding.tenantId, from, {
    role: 'user',
    text,
    at: new Date(now()).toISOString(),
  });

  const wasActive = binding.status === 'active' && !isWechatSessionExpired(binding, now());
  // 激活：paired/expired → active + 打招呼（不跑 LLM）
  if (!wasActive) {
    await updateBinding(db, binding.tenantId, { status: 'active', lastInteractionAt: now() });
    const petName = await readPetName(db, binding.tenantId);
    const greeting = buildGreeting(petName);
    await client.sendMessage(from, greeting, { contextToken: message.context_token });
    await appendChatLine(dataDir, binding.tenantId, from, {
      role: 'bot',
      text: greeting,
      at: new Date(now()).toISOString(),
    });
    return { replied: true, activated: true, reply: greeting };
  }

  // active：spawn 短命 agent 生成回复 → 发微信
  const reply = await runReplyWorker({
    dataDir,
    tenantId: binding.tenantId,
    userId: from,
    message: text,
    petName: await readPetName(db, binding.tenantId),
    spawnFn: deps.spawnFn,
    command: deps.command,
  });
  await updateBinding(db, binding.tenantId, { lastInteractionAt: now() });
  await client.sendMessage(from, reply, { contextToken: message.context_token });
  await appendChatLine(dataDir, binding.tenantId, from, {
    role: 'bot',
    text: reply,
    at: new Date(now()).toISOString(),
  });
  return { replied: true, activated: false, reply };
}

/** 读宠物名（微信租户必有；缺省回退默认名） */
async function readPetName(db: ControlDb, tenantId: string): Promise<string> {
  const pet = await db.select().from(pets).where(eq(pets.tenantId, tenantId)).get();
  return pet?.name ?? '街溜子';
}

/**
 * spawn wechat-reply-cli 并透传 stdout 结果。失败抛错（上层记 lastError）。
 * secrets：S4 解密 → 0600 临时文件 → --secrets-file（跑完即删，同 worker-runner）。
 */
export async function runReplyWorker(opts: {
  dataDir: string;
  tenantId: string;
  userId: string;
  message: string;
  petName: string;
  spawnFn?: ReplySpawn;
  command?: string;
}): Promise<string> {
  const { dataDir, tenantId, userId, message, petName } = opts;
  const spawnFn = opts.spawnFn ?? realSpawn;
  const command = opts.command ?? process.env.CP_WORKER_CMD ?? 'bun';
  const open = openTenantSecrets;
  const secretsPath = await writeSecretsFile(open, dataDir, tenantId);
  try {
    const args = [WECHAT_REPLY_CLI, '--data-dir', dataDir, '--user-id', userId, '--message', message, '--pet-name', petName];
    if (secretsPath) args.push('--secrets-file', secretsPath);
    const { exitCode, stdout } = await spawnFn(command, args);
    if (exitCode !== 0) {
      throw new Error(`wechat-reply worker 退出码 ${exitCode}`);
    }
    const parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '') as {
      ok: boolean;
      reply?: string;
      error?: string;
    };
    if (!parsed.ok || typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
      throw new Error(parsed.error ?? '回复为空');
    }
    return parsed.reply.trim();
  } finally {
    if (secretsPath) {
      await rm(secretsPath, { force: true });
    }
  }
}

/** 发送失败按错误分类：会话失效 → 标记 expired（需主人重新打招呼激活） */
export async function handleSendFailure(
  db: ControlDb,
  tenantId: string,
  error: unknown,
): Promise<void> {
  if (error instanceof IlinkSessionInvalidError) {
    await updateBinding(db, tenantId, {
      status: 'expired',
      lastError: `会话失效（${error.message}）`,
    });
  } else {
    await updateBinding(db, tenantId, {
      lastError: error instanceof Error ? error.message : String(error),
    });
  }
}
