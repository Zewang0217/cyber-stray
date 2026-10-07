/**
 * 表情包文案生成器（#96）—— LLM 出梗文案
 *
 * 纯函数层（可测）：buildMemeCopyPrompt（话题 → prompt）、parseMemeCopy
 * （Zod 校验 LLM 产出，禁兜底——字段缺失/非法显式抛错）。
 * I/O 层：generateMemeCopy（AI SDK generateText，模型由调用方注入）。
 *
 * 图文分离：同一次调用产出梗文案与无字场景，生图只消费场景，
 * 文案由程序叠加（ADR-0001）。话题/情绪用于图鉴检索。
 */

import { generateText } from 'ai';
import { sanitizeForLLM } from '../utils/text-sanitize.js';
import { z } from 'zod';
import { getDataRoot } from '../config.js';
import { assertUsageReady, recordUsage, modelIdOf } from '../usage/usage.js';
import type { MemeCopy } from './types.js';

/** LLM 产出 schema；scene 必须是可直接用于生图的具体无字场景。 */
const MemeCopySchema = z.object({
  text: z.string().min(1).max(120).describe('梗文案，程序叠加到画面上'),
  emotion: z.string().min(1).max(20).describe('情绪标签，如 开心/自嘲/吐槽/燃'),
  scene: z.string().trim().min(5).max(240).describe('与话题和文案呼应的无字画面，描述动作、道具或反差'),
  topic: z.string().min(1).max(60).optional().describe('话题（回显触发话题，供图鉴对账）'),
}).refine((copy) => !copy.scene.includes(copy.text), {
  message: 'scene 不得包含将由程序叠加的梗文案原文',
  path: ['scene'],
});

/** 文案生成入参 */
export interface MemeCopyInput {
  /** 触发话题（宠物游荡/日记里的兴趣） */
  topic: string;
  /** 宠物名（语气注入） */
  petName: string;
  /** 性格（语气注入，可选） */
  personalityName?: string;
}

/** 纯函数：话题 → 梗文案 prompt */
export function buildMemeCopyPrompt(input: MemeCopyInput): string {
  const persona = input.personalityName ? `（性格：${input.personalityName}）` : '';
  return [
    `你是${input.petName}${persona}，一只赛博宠物。现在要把话题"${input.topic}"做成一张表情包。`,
    '请产出一句简短、有梗、符合你性格的中文梗文案（10-40 字，自然口语，能让人会心一笑或共鸣）。',
    '同时给这个表情包打一个情绪标签（2 字以内，如 开心/自嘲/吐槽/燃/丧）。',
    '再构思一个与话题和梗文案呼应的具体无字画面（5-240 字）：写清宠物的动作、道具或有趣的反差，让人不读字也能看懂笑点。画面内不出现文字、字母、标牌或梗文案原文。',
    '只输出 JSON：{"text": "梗文案", "emotion": "情绪标签", "scene": "具体无字画面", "topic": "话题"}。',
  ].join('\n');
}

/** 纯函数：校验并规范化 LLM 产出的文案 JSON（禁兜底——非法显式抛错） */
export function parseMemeCopy(raw: string, expectedTopic: string): MemeCopy {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/, '')
    .replace(/```\s*$/, '')
    .trim();
  const parsed = MemeCopySchema.safeParse(JSON.parse(cleaned));
  if (!parsed.success) {
    throw new Error(`表情包文案产出非法: ${parsed.error.message}`);
  }
  return {
    text: parsed.data.text,
    emotion: parsed.data.emotion,
    scene: parsed.data.scene,
    topic: parsed.data.topic ?? expectedTopic,
  };
}

/** 生成表情包文案（AI SDK generateText；模型由调用方注入，测试可 mock） */
export async function generateMemeCopy(
  prompt: string,
  model: Parameters<typeof generateText>[0]['model'],
  abortSignal?: AbortSignal,
): Promise<string> {
  assertUsageReady(getDataRoot(), modelIdOf(model), 'llm');
  const result = await generateText({ model, temperature: 0.9, prompt: sanitizeForLLM(prompt), abortSignal });
  // 付费调用完成后记账；故障上抛，由 CP 停止后续派发。
  await recordUsage(getDataRoot(), {
    kind: 'llm',
    model: modelIdOf(model),
    inputTokens: result?.usage?.inputTokens,
    outputTokens: result?.usage?.outputTokens,
  });
  return result.text;
}
