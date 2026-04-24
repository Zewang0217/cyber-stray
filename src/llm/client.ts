import { generateText } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { z } from 'zod';
import { config } from '../config.js';
import { consola } from '../logger.js';
import { VALID_ACTIONS } from '../constants/decision.js';
import type { Decision } from '../types.js';

const logger = consola.withTag('llm');

/**
 * 初始化 DeepSeek Provider
 * 使用官方 @ai-sdk/deepseek，原生处理 reasoning_content 多轮传递
 */
function createDeepSeekProvider() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('缺少环境变量 DEEPSEEK_API_KEY');
  }

  return createDeepSeek({ apiKey });
}

// 缓存 Provider 实例，避免重复创建
let deepseekProvider: ReturnType<typeof createDeepSeekProvider> | null = null;

function getProvider() {
  if (!deepseekProvider) {
    deepseekProvider = createDeepSeekProvider();
  }
  return deepseekProvider;
}

/**
 * 调用 LLM 生成自由文本
 *
 * 适用于：内心独白、人格化文案、非结构化思考
 */
export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  temperature?: number,
): Promise<string> {
  const provider = getProvider();
  const effectiveTemperature = temperature ?? config.llmTemperature;

  logger.debug('调用 LLM', {
    model: config.llmModel,
    temperature: effectiveTemperature,
    systemLength: systemPrompt.length,
    userLength: userPrompt.length,
  });

  const { text } = await generateText({
    model: provider.chat(config.llmModel),
    temperature: effectiveTemperature,
    system: systemPrompt,
    prompt: userPrompt,
  });

  logger.debug('LLM 响应', { textLength: text.length });

  return text;
}

/**
 * 调用 LLM 生成结构化决策对象
 *
 * 适用于：Planner 决策，输出固定 schema 确保下游可解析
 */
export async function callLLMForDecision(
  systemPrompt: string,
  userPrompt: string,
): Promise<Decision> {
  const provider = getProvider();

  logger.debug('调用 LLM（结构化输出）', {
    model: config.llmModel,
    systemLength: systemPrompt.length,
    userLength: userPrompt.length,
  });

  const jsonSchema = z.object({
    action: z.string().refine(
      (val: string) => VALID_ACTIONS.includes(val as (typeof VALID_ACTIONS)[number]),
      {
        message: `无效行动，可用: ${VALID_ACTIONS.join(', ')}`,
      },
    ),
    reasoning: z.string(),
    topic: z.string().optional(),
  });

  const { text } = await generateText({
    model: provider.chat(config.llmModel),
    temperature: config.llmTemperature,
    system: systemPrompt,
    prompt: userPrompt,
  });

  let parsed: z.infer<typeof jsonSchema>;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('响应中未找到 JSON 对象');
    }
    parsed = jsonSchema.parse(JSON.parse(jsonMatch[0]));
  } catch (parseError) {
    logger.error('JSON 解析失败', { text, error: parseError });
    throw new Error(`LLM 响应解析失败: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
  }

  logger.debug('LLM 决策结果', {
    action: parsed.action,
    reasoning: parsed.reasoning,
    hasTopic: !!parsed.topic,
  });

  return {
    action: parsed.action as (typeof VALID_ACTIONS)[number],
    reasoning: parsed.reasoning,
    params: parsed.topic ? { topic: parsed.topic } : undefined,
  };
}
