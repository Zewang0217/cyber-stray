import { appendFile, mkdir } from 'fs/promises';
import { consola } from '../../logger.js';
import { config } from '../../config.js';
import { sendFeishuMessage } from './lark-sender.js';
import { getInterestGraph } from '../../memory/interest-graph.js';
import { registerSpeakTopics } from '../../memory/feedback-pipeline.js';

const logger = consola.withTag('speak');

/** speak 工具内容类型 */
export type SpeakType = 'share' | 'nonsense' | 'article';

/** speak 工具入参 */
export interface SpeakInput {
  content: string;
  type: SpeakType;
}

/** speak 工具返回值 */
export interface SpeakResult {
  success: boolean;
  pushed: boolean;     // 是否已推送到飞书/Telegram
  timestamp: string;
  messageId?: string; // 飞书消息 ID（用于关联反馈）
  error?: string;      // 推送失败时的错误信息
}

/** 推送历史记录条目 */
interface SpeakRecord {
  content: string;
  type: SpeakType;
  pushed: boolean;
  timestamp: string;
  messageId?: string; // 飞书消息 ID
}

/**
 * 追加到推送历史记录文件
 */
async function appendSpeakHistory(record: SpeakRecord): Promise<void> {
  try {
    await mkdir('data/history', { recursive: true });
    const filename = `data/history/speaks-${new Date().toISOString().slice(0, 10)}.jsonl`;
    const line = JSON.stringify(record) + '\n';
    await appendFile(filename, line, 'utf-8');
  } catch (error) {
    // 日志记录失败不影响主流程
    logger.warn('记录推送历史失败', { error });
  }
}

/**
 * 推送到 Telegram
 */
async function pushToTelegram(content: string): Promise<void> {
  const token = config.telegramBotToken;
  const chatId = config.telegramChatId;

  if (!token || !chatId) {
    throw new Error('未配置 TELEGRAM_BOT_TOKEN 或 TELEGRAM_CHAT_ID');
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = JSON.stringify({
    chat_id: chatId,
    text: content,
    parse_mode: 'HTML',
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Telegram 推送失败: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { ok?: boolean; description?: string };
  if (!data.ok) {
    throw new Error(`Telegram 推送失败: ${data.description ?? '未知错误'}`);
  }
}

/**
 * speak 工具：表达（分享链接、碎碎念、写文章）
 *
 * 会尝试推送到所有已配置的渠道（飞书、Telegram）。
 * 推送失败时记录错误但不中断 ReAct Loop（返回 pushed: false）。
 *
 * 飞书发送方式根据 feishu.pushMode 配置：
 * - lark_channel: 使用 LarkChannel（默认）
 * - webhook: 使用传统 Webhook
 */
export async function speak(content: string, type: SpeakType): Promise<SpeakResult> {
  const timestamp = new Date().toISOString();

  logger.info('speak 调用', { type, contentLength: content.length });

  // 内容长度检查
  if (!content.trim()) {
    logger.warn('speak 内容为空');
    return {
      success: false,
      pushed: false,
      timestamp,
      error: '内容不能为空',
    };
  }

  // share 类型建议包含 URL（软检查，不强制）
  if (type === 'share' && !content.includes('http')) {
    logger.warn('share 类型的内容不包含 URL', { content: content.slice(0, 50) });
  }

  let pushed = false;
  let messageId: string | undefined;
  const pushErrors: string[] = [];

  // 推送到飞书（根据配置选择方式）
  if (config.feishu?.pushMode === 'lark_channel') {
    // LarkChannel 方式
    if (config.larkAppId && config.larkAppSecret) {
      try {
        messageId = await sendFeishuMessage(content);
        pushed = true;
        logger.success('飞书（LarkChannel）推送成功', { messageId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushErrors.push(`飞书: ${message}`);
        logger.error('飞书（LarkChannel）推送失败', { error: message });
      }
    } else {
      logger.warn('未配置 LARK_APP_ID/LARK_APP_SECRET，无法使用 LarkChannel');
    }
  } else if (config.feishuWebhook) {
    // Webhook 方式
    try {
      messageId = await sendFeishuMessage(content);
      pushed = true;
      logger.success('飞书（Webhook）推送成功', { messageId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushErrors.push(`飞书: ${message}`);
      logger.error('飞书（Webhook）推送失败', { error: message });
    }
  }

  // 尝试推送到 Telegram
  if (config.telegramBotToken && config.telegramChatId) {
    try {
      await pushToTelegram(content);
      pushed = true;
      logger.success('Telegram 推送成功');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushErrors.push(`Telegram: ${message}`);
      logger.error('Telegram 推送失败', { error: message });
    }
  }

  // 没有配置任何推送渠道时，只记录日志
  if (!config.feishu?.pushMode && !config.feishuWebhook && (!config.telegramBotToken || !config.telegramChatId)) {
    logger.info('无推送渠道配置，内容仅记录日志', { content });
  }

  // 记录到历史文件
  await appendSpeakHistory({ content, type, pushed, timestamp, messageId });

  // Phase 3: 注册消息-兴趣映射，供后续反馈强化
  if (pushed && messageId) {
    try {
      const graph = getInterestGraph();
      const topTopics = graph.getTopInterests(3, 0.05);
      if (topTopics.length > 0) {
        registerSpeakTopics(messageId, topTopics);
      }
    } catch (error) {
      // InterestGraph 不可用时静默跳过，不影响 speak 结果
      logger.warn('注册消息-兴趣映射失败', { error });
    }
  }

  const result: SpeakResult = {
    success: true,
    pushed,
    timestamp,
    messageId,
  };

  if (pushErrors.length > 0 && !pushed) {
    result.error = pushErrors.join('; ');
  }

  logger.info('speak 完成', { type, pushed, messageId, hasErrors: pushErrors.length > 0 });

  return result;
}
