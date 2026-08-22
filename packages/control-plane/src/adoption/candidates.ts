/**
 * 领养候选生成（#114 切片 3 / ADR 0005）
 *
 * 起名/口头禅步的 3 候选：LLM 一次返回（DeepSeek chat completions），
 * 失败降级本地模板——领养不阻塞（ADR 决策 4）。候选生成无状态：
 * "换一批"由客户端计数限 3 次，batch 随请求传入用于 LLM 提示与本地
 * 模板轮换（fallback 在无 key/超时/解析失败时也随 batch 变化）。
 *
 * mock 友好：fetch 注入（同 petgen/qwen.ts 模式），测试不打真实 API。
 */

import { getPersonality, isPersonalityId, type PersonalityId } from '@cyber-stray/shared';

/** 候选步（性格/兴趣步无需 AI——注册表固定 4 型/纯自选） */
export type CandidateStep = 'name' | 'catchphrase';

/** 候选生成请求 */
export interface CandidateRequest {
  step: CandidateStep;
  /** 宠物名（catchphrase 步必填——候选依赖名字+性格上下文） */
  name?: string;
  /** 性格（catchphrase 步必填） */
  personality?: string;
  /** 第几批（0 起客户端计数；≤3） */
  batch?: number;
}

/** 起名候选的本地模板池（领养感、无 LLM 也可用；按 batch 轮换） */
const NAME_FALLBACK_POOL: string[][] = [
  ['小溜', '煤球', '年糕'],
  ['团子', '芝麻', '汤圆'],
  ['麻薯', '橘子', '雪球'],
  ['布丁', '瓜子', '豆包'],
];

const DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/chat/completions';
const REQUEST_TIMEOUT_MS = 12_000;

/** 单步 prompt 组装（name 步无上下文；catchphrase 步带名字+性格语气） */
function buildPrompt(req: CandidateRequest): { system: string; user: string } {
  const batch = req.batch ?? 0;
  if (req.step === 'name') {
    return {
      system:
        '你是宠物领养游戏的起名助手。用户在领养一只赛博猫（电子宠物），' +
        '需要给它起个名字。返回恰好 3 个候选名字的 JSON 数组，' +
        '不要输出任何其他文本。名字要求：中文、1-8 字、亲切有领养感、' +
        '像真实会给猫取的昵称（如 煤球/年糕/小溜 这类），三个名字风格各异。',
      user:
        batch > 0
          ? `第 ${batch + 1} 批——给 3 个和之前不一样的名字。`
          : '给这只即将被领养的赛博猫起 3 个名字。',
    };
  }
  const personality = isPersonalityId(req.personality) ? req.personality : 'curious';
  const p = getPersonality(personality);
  return {
    system:
      '你是宠物领养游戏的口头禅设计助手。宠物是一只赛博猫，即将被主人领养。' +
      '返回恰好 3 条候选口头禅的 JSON 数组，不要输出任何其他文本。' +
      '口头禅要求：中文、2-12 字、纯文字不带 emoji、体现这只猫的性格与说话习惯、' +
      `要自然地嵌进它平时说的话里（如"喵——让我看看"），三条风格不同。`,
    user:
      `宠物名字：${req.name ?? ''}\n性格：${p.name}（${p.description}）\n` +
      (batch > 0 ? `第 ${batch + 1} 批——给 3 条和之前不一样的口头禅。` : '给它设计 3 条口头禅。'),
  };
}

/** 本地降级模板（batch 轮换；口头禅 = 性格默认组） */
export function fallbackCandidates(req: CandidateRequest): string[] {
  const batch = Math.min(Math.max(req.batch ?? 0, 0), NAME_FALLBACK_POOL.length - 1);
  if (req.step === 'name') {
    return NAME_FALLBACK_POOL[batch]!;
  }
  const personality: PersonalityId = isPersonalityId(req.personality) ? req.personality : 'curious';
  return getPersonality(personality).catchphrases.map((c) => c.text);
}

/** 解析 LLM 输出：剥 code fence → JSON.parse → 恰好 3 条非空字符串 */
export function parseCandidates(raw: string): string[] | null {
  const stripped = raw.replace(/```(?:json)?/g, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) return null;
  if (!parsed.every((s) => typeof s === 'string' && s.trim().length > 0 && s.length <= 24)) {
    return null;
  }
  return (parsed as string[]).map((s) => s.trim());
}

export interface GenerateOptions {
  /** 注入式 fetch（测试 fake；最小签名——不要求 DOM fetch 的全属性） */
  fetchFn?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  model?: string;
}

export interface CandidatesResult {
  candidates: string[];
  /** llm | fallback（降级时仍 200——领养不阻塞） */
  source: 'llm' | 'fallback';
}

/** DeepSeek chat 响应 shape（只取需要的字段） */
interface ChatCompletionJson {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * 生成 3 候选。apiKey 为空 / 请求失败 / 输出不合法 → 降级本地模板。
 */
export async function generateCandidates(
  req: CandidateRequest,
  apiKey: string,
  opts: GenerateOptions = {},
): Promise<CandidatesResult> {
  if (!apiKey) return { candidates: fallbackCandidates(req), source: 'fallback' };
  const { system, user } = buildPrompt(req);
  const fetchFn = opts.fetchFn ?? fetch;
  try {
    const res = await fetchFn(DEEPSEEK_CHAT_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model ?? 'deepseek-chat',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 1.2,
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return { candidates: fallbackCandidates(req), source: 'fallback' };
    const json = (await res.json()) as ChatCompletionJson;
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return { candidates: fallbackCandidates(req), source: 'fallback' };
    }
    const candidates = parseCandidates(content);
    if (!candidates) return { candidates: fallbackCandidates(req), source: 'fallback' };
    return { candidates, source: 'llm' };
  } catch (error) {
    // 网络错误/超时/JSON 解析异常 → 降级（ADR：领养不阻塞）；留 stderr 痕迹可查
    console.error(`[adoption-candidates] LLM 失败降级本地模板: ${String(req.step)}`, error);
    return { candidates: fallbackCandidates(req), source: 'fallback' };
  }
}
