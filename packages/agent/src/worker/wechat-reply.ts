/**
 * 微信回复生成（#97）——互动闭环的 agent 侧核心（CP spawn 的短命 worker 用）。
 *
 * 输入：租户数据目录 + 主人消息 + 宠物名；读租户目录的微信聊天历史做
 * 上下文（CP 是唯一写者，worker 只读）→ 调 LLM 生成一句简短回复。
 * 输出：{ reply }（纯文本，CP 负责 sendmessage + 历史落盘）。
 *
 * 无工具、无 ReAct——聊天回复不需要搜索/网页；保持 worker 轻量快速。
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { generateText } from 'ai';
import { sanitizeForLLM } from '../utils/text-sanitize.js';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { loadConfig, setTenantContext } from '../config.js';
import { recordUsage } from '../usage/usage.js';
import type { AgentSecrets } from '../types.js';

export interface WechatReplyOptions {
  /** 租户数据目录（DATA_DIR） */
  dataDir: string;
  /** 主人微信身份（ilink_user_id） */
  userId: string;
  /** 主人最新消息 */
  message: string;
  /** 宠物名（打招呼/人设用） */
  petName: string;
  /** per-tenant secrets（CP 解密后经 --secrets-file 注入） */
  secrets?: AgentSecrets;
  /** 注入式 LLM（测试）；缺省 createDeepSeek + generateText */
  llm?: (system: string, user: string) => Promise<string>;
  /** 注入式历史（测试）；缺省从租户目录读取 */
  history?: ChatLine[];
}

export interface ChatLine {
  role: 'user' | 'bot';
  text: string;
  at: string;
}

/** 用户 id 文件名安全化（与 CP 侧 chat-history.ts 同步约定） */
export function safeUserId(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** 读租户目录微信聊天历史（最近 N 条；缺失 = 空） */
export async function readWechatHistory(
  dataDir: string,
  userId: string,
  limit = 10,
): Promise<ChatLine[]> {
  const file = join(dataDir, 'wechat', `chat-${safeUserId(userId)}.jsonl`);
  let content: string;
  try {
    content = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const out: ChatLine[] = [];
  for (const line of content.split('\n').filter(Boolean).slice(-limit)) {
    try {
      const parsed = JSON.parse(line) as ChatLine;
      if (parsed && typeof parsed.text === 'string') out.push(parsed);
    } catch {
      // 单行损坏跳过
    }
  }
  return out;
}

/** 组装回复 prompt（system 人设 + user 历史上下文）——纯函数可测 */
export function buildReplyPrompt(opts: {
  petName: string;
  history: ChatLine[];
  message: string;
}): { system: string; user: string } {
  const system =
    `你是「${opts.petName}」,一只住在云端、靠好奇心探索世界的赛博街溜子宠物。` +
    `你正在微信里和主人聊天。请用自然、亲切、简短的中文回复(一般不超过 200 字),` +
    `符合宠物人设:好奇、爱碎碎念、偶尔傲娇,但永远真诚。` +
    `不要提及你是 AI、模型或程序,不要使用 markdown 重语法(最多用 *强调*)。`;
  const history = opts.history
    .map((line) => `${line.role === 'user' ? '主人' : opts.petName}: ${line.text}`)
    .join('\n');
  const user =
    `${history ? `最近的聊天:\n${history}\n\n` : ''}` +
    `主人最新消息: ${opts.message}\n\n请回复主人:`;
  return { system, user };
}

/**
 * 生成一条微信回复。失败抛错（不兜底——CP 层记 lastError 并留痕）。
 */
export async function runWechatReply(
  options: WechatReplyOptions,
): Promise<{ reply: string }> {
  const { dataDir, userId, message, petName } = options;
  const history = options.history ?? (await readWechatHistory(dataDir, userId));
  const { system, user } = buildReplyPrompt({ petName, history, message });

  let reply: string;
  if (options.llm) {
    reply = await options.llm(system, user);
  } else {
    // 短命 worker：加载租户配置（行为参数 + secrets）→ 设置租户上下文 →
    // 建 DeepSeek provider → generateText（无工具，单次完成）
    const config = loadConfig(dataDir, options.secrets);
    setTenantContext({ tenantId: 'wechat-reply-worker', dataDir, config });
    try {
      const apiKey = config.secrets?.deepseekApiKey ?? process.env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        throw new Error('缺少 DEEPSEEK_API_KEY（请在设置页绑定或配置环境变量）');
      }
      const provider = createDeepSeek({ apiKey });
      const result = await generateText({
        model: provider.chat(config.llmModel),
        system: sanitizeForLLM(system),
        prompt: sanitizeForLLM(user),
        temperature: 0.8,
        maxOutputTokens: 500,
      });
      // #129：用量记录（no-throw）
      void recordUsage(dataDir, {
        kind: 'llm',
        model: config.llmModel,
        inputTokens: result?.usage?.inputTokens,
        outputTokens: result?.usage?.outputTokens,
      });
      reply = result.text;
    } finally {
      setTenantContext(null);
    }
  }

  // 两条路径统一收口：trim + 空回复显式报错（不兜底）
  const trimmed = reply.trim();
  if (!trimmed) throw new Error('LLM 返回空回复');
  return { reply: trimmed };
}
