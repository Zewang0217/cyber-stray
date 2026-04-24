import { consola } from '../../logger.js';
import { callLLM } from '../../llm/client.js';
import { buildContentSystemPrompt, buildContentUserPrompt } from '../../prompts/content.js';
import type { AgentState, PushContent } from '../../types.js';
import type { FilteredResult } from '../filter/index.js';

const logger = consola.withTag('content');

/** 默认文案（LLM 调用失败时的回退） */
const DEFAULT_MESSAGE = '嘿，找到个有意思的东西，看看？';

/** 文案生成 LLM temperature —— 高随机性，增加多样性 */
const CONTENT_TEMPERATURE = 0.9;

/**
 * 根据最佳筛选结果和 Agent 当前状态，生成人格化推送内容
 *
 * 策略：
 * - title / url / summary 直接从 result 取（不走 LLM）
 * - message（推荐语）由 LLM 生成，temperature = 0.9
 * - LLM 失败时返回默认文案，保证主循环不 crash
 */
export async function generatePushContent(
  result: FilteredResult,
  state: AgentState,
): Promise<PushContent> {
  const summary = result.content.length > 0 ? result.content : result.title;

  logger.debug('开始生成文案', {
    title: result.title,
    score: result.score,
    mood: state.mood,
    temper: state.temper,
  });

  let message: string;

  try {
    const systemPrompt = buildContentSystemPrompt();
    const userPrompt = buildContentUserPrompt(result, state);

    const rawText = await callLLM(systemPrompt, userPrompt, CONTENT_TEMPERATURE);

    // 去除首尾空白和多余换行
    message = rawText.trim().replace(/\n+/g, ' ');

    if (!message) {
      logger.warn('LLM 返回空文案，使用默认文案');
      message = DEFAULT_MESSAGE;
    }

    logger.success('文案生成完成', { title: result.title, message });
  } catch (error) {
    logger.error('文案生成失败，使用默认文案', { error });
    message = DEFAULT_MESSAGE;
  }

  return {
    title: result.title,
    url: result.url,
    summary,
    message,
    mood: state.mood,
    timestamp: new Date().toISOString(),
  };
}
