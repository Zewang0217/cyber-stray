/** Provider boundary for metered adoption candidates. Failures remain visible to the caller. */
import { z } from 'zod';
import { getPersonality, isPersonalityId } from '@cyber-stray/shared';
import { requireModelPrice } from '../domain/pricing.js';
import { CandidateRequestError } from './candidate-store.js';

export const CandidateRequestSchema = z.object({
  step: z.enum(['name', 'catchphrase']),
  name: z.string().trim().min(1).max(20).optional(),
  personality: z.string().refine(isPersonalityId).optional(),
  batch: z.number().int().min(0).max(3).default(0),
}).refine((v) => v.step !== 'catchphrase' || (v.name !== undefined && v.personality !== undefined),
  '口头禅候选需要名字和性格');
export type CandidateRequest = z.input<typeof CandidateRequestSchema>;
export type CandidateStep = CandidateRequest['step'];
const CandidatesSchema = z.array(z.string().trim().min(1).max(24)).length(3);
const ResponseUsageSchema = z.object({ usage: z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
}) });
const ResponseContentSchema = z.object({ choices: z.array(z.object({
  message: z.object({ content: z.string() }),
})).min(1) });
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
  const personality = req.personality!;
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

/** Parse provider text without turning invalid output into successful candidates. */
export function parseCandidates(raw: string): string[] | null {
  try {
    const result = CandidatesSchema.safeParse(JSON.parse(raw.replace(/```(?:json)?/g, '').trim()));
    return result.success ? result.data : null;
  } catch { return null; }
}

export interface GenerateOptions {
  fetchFn?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  model?: string;
  onUsage: (usage: { tokens: number; inputTokens: number; outputTokens: number }) => Promise<void>;
  onAccountingFailure?: (error: unknown) => Promise<void>;
}
export interface CandidatesResult { candidates: string[]; source: 'llm' }

/** Account for every successful provider response, including unusable generated content. */
export async function generateCandidates(
  request: CandidateRequest, apiKey: string, opts: GenerateOptions,
): Promise<CandidatesResult> {
  const req = CandidateRequestSchema.parse(request);
  if (!apiKey) throw new CandidateRequestError('候选生成未配置 API key，请手动填写或联系管理员', 503);
  const model = opts.model ?? 'deepseek-chat';
  requireModelPrice(model, 'llm');
  const { system, user } = buildPrompt(req);
  const res = await (opts.fetchFn ?? fetch)(DEEPSEEK_CHAT_URL, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [
      { role: 'system', content: system }, { role: 'user', content: user },
    ], temperature: 1.2, max_tokens: 200 }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new CandidateRequestError(`候选生成服务返回 HTTP ${res.status}`, 502);
  let json: unknown;
  let usage: z.infer<typeof ResponseUsageSchema>['usage'];
  try {
    json = await res.json();
    usage = ResponseUsageSchema.parse(json).usage;
  } catch (cause) {
    await opts.onAccountingFailure?.(cause);
    throw new CandidateRequestError('候选服务未返回有效用量，生成已暂停，请联系管理员', 502);
  }
  await opts.onUsage({ inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens,
    tokens: usage.prompt_tokens + usage.completion_tokens });
  const parsed = ResponseContentSchema.safeParse(json);
  const candidates = parsed.success ? parseCandidates(parsed.data.choices[0]!.message.content) : null;
  if (!candidates) throw new CandidateRequestError('候选内容格式无效，请换一批或手动填写', 502);
  return { candidates, source: 'llm' };
}
