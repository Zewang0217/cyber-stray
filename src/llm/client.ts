import { generateText, generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { config } from '../config.js';
import { consola } from '../logger.js';
import { VALID_ACTIONS } from '../constants/decision.js';
import type { Decision } from '../types.js';

const logger = consola.withTag('llm');

/**
 * 初始化 DeepSeek Provider
 * DeepSeek 兼容 OpenAI API 格式，使用 @ai-sdk/openai 适配
 */
function createDeepSeekProvider() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('缺少环境变量 DEEPSEEK_API_KEY');
  }

  return createOpenAI({
    baseURL: 'https://api.deepseek.com/v1',
    apiKey,
  });
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
): Promise<string> {
  const provider = getProvider();

  logger.debug('调用 LLM', {
    model: config.llmModel,
    systemLength: systemPrompt.length,
    userLength: userPrompt.length,
  });

  const { text } = await generateText({
    model: provider(config.llmModel),
    temperature: config.llmTemperature,
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

  const { object } = await generateObject({
    model: provider(config.llmModel),
    temperature: config.llmTemperature,
    system: systemPrompt,
    prompt: userPrompt,
    schema: z.object({
      action: z.string().refine(
        (val: string) => VALID_ACTIONS.includes(val as (typeof VALID_ACTIONS)[number]),
        {
          message: `无效行动，可用: ${VALID_ACTIONS.join(', ')}`,
        },
      ),
      reasoning: z.string(),
      topic: z.string().optional(),
    }),
  });

  logger.debug('LLM 决策结果', {
    action: object.action,
    reasoning: object.reasoning,
    hasTopic: !!object.topic,
  });

  return {
    action: object.action as (typeof VALID_ACTIONS)[number],
    reasoning: object.reasoning,
    params: object.topic ? { topic: object.topic } : undefined,
  };
}
