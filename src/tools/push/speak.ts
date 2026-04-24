import { appendFile, mkdir } from 'fs/promises';
import { consola } from '../../logger.js';
import { config } from '../../config.js';

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
  error?: string;      // 推送失败时的错误信息
}

/** 推送历史记录条目 */
interface SpeakRecord {
  content: string;
  type: SpeakType;
  pushed: boolean;
  timestamp: string;
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
 * 推送到飞书 Webhook
 */
async function pushToFeishu(content: string): Promise<void> {
  const webhook = config.feishuWebhook;
  if (!webhook) {
    throw new Error('未配置 FEISHU_WEBHOOK');
  }

  const body = JSON.stringify({
    msg_type: 'text',
    content: { text: content },
  });

  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`飞书推送失败: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { code?: number; msg?: string };
  if (data.code !== 0) {
    throw new Error(`飞书推送失败: ${data.msg ?? '未知错误'}`);
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
  const pushErrors: string[] = [];

  // 尝试推送到飞书
  if (config.feishuWebhook) {
    try {
      await pushToFeishu(content);
      pushed = true;
      logger.success('飞书推送成功');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushErrors.push(`飞书: ${message}`);
      logger.error('飞书推送失败', { error: message });
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
  if (!config.feishuWebhook && (!config.telegramBotToken || !config.telegramChatId)) {
    logger.info('无推送渠道配置，内容仅记录日志', { content });
  }

  // 记录到历史文件
  await appendSpeakHistory({ content, type, pushed, timestamp });

  const result: SpeakResult = {
    success: true,
    pushed,
    timestamp,
  };

  if (pushErrors.length > 0 && !pushed) {
    result.error = pushErrors.join('; ');
  }

  logger.info('speak 完成', { type, pushed, hasErrors: pushErrors.length > 0 });

  return result;
}
