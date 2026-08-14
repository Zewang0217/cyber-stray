import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { consola } from '../../logger.js';
import { getConfig, getDataPath } from '../../config.js';
import { sendFeishuMessage } from './lark-sender.js';
import { registerSpeakTopics } from '../../memory/feedback-pipeline.js';
import { buildSpeakRecord, type SpeakRecord, type SpeakRecordMeta } from './history-record.js';
import type { Mood } from '../../types.js';

const logger = consola.withTag('speak');

/** speak 工具内容类型。与 memory/push-gate.ts 的 SpeakType 同步保持。 */
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
  /** Phase 5: 是否被推送门控拦截 */
  gated?: boolean;
  /** Phase 5: 门控评分 */
  gateScore?: number;
  /** Phase 5: 门控理由 */
  gateReasons?: string[];
  timestamp: string;
  messageId?: string; // 飞书消息 ID（用于关联反馈）
  error?: string;      // 推送失败时的错误信息
}

/**
 * 追加到推送历史记录文件
 */
async function appendSpeakHistory(record: SpeakRecord): Promise<void> {
  try {
    const historyDir = getDataPath('history');
    await mkdir(historyDir, { recursive: true });
const filename = join(historyDir, `speaks-${new Date().toISOString().slice(0, 10)}.jsonl`);
    const line = JSON.stringify(record) + '\n';
    await appendFile(filename, line, 'utf-8');
  } catch (error) {
    // 日志记录失败不影响主流程
    logger.warn('记录推送历史失败', { error });
  }
}

/**
 * 记录一条被推送门控拦截的内容
 *
 * 门控拦截发生在 speak() 之前，走不到正常的历史写入路径。但"学了什么却没告诉
 * 主人"同样是需要留痕的信息，仪表盘据此展示"仅学习"状态。
 */
export async function recordGatedSpeak(
  content: string,
  type: SpeakType,
  meta: SpeakRecordMeta = {},
): Promise<void> {
  await appendSpeakHistory(
    buildSpeakRecord(content, type, false, new Date().toISOString(), {
      ...meta,
      gated: true,
    }),
  );
}

/**
 * 推送到 Telegram
 */
async function pushToTelegram(content: string): Promise<void> {
  const cfg = getConfig();
  const token = cfg.telegramBotToken;
  const chatId = cfg.telegramChatId;

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
export async function speak(
  content: string,
  type: SpeakType,
  meta: { mood?: Mood; gateScore?: number; matchedTopics?: string[] } = {},
): Promise<SpeakResult> {
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
  const cfg = getConfig();

  // 推送到飞书（根据配置选择方式）
  if (cfg.feishu?.pushMode === 'lark_channel') {
    // LarkChannel 方式
    if (cfg.larkAppId && cfg.larkAppSecret) {
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
  } else if (cfg.feishuWebhook) {
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
  if (cfg.telegramBotToken && cfg.telegramChatId) {
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
  if (!cfg.feishu?.pushMode && !cfg.feishuWebhook && (!cfg.telegramBotToken || !cfg.telegramChatId)) {
    logger.info('无推送渠道配置，内容仅记录日志', { content });
  }

  // 记录到历史文件
  await appendSpeakHistory(
    buildSpeakRecord(content, type, pushed, timestamp, {
      messageId,
      mood: meta.mood,
      gateScore: meta.gateScore,
    }),
  );

  // Phase 3: 注册消息-兴趣映射，供后续反馈强化。
  // 用门控算出的实际命中话题，而非图谱 Top N——后者与内容无关，会导致每次
  // 反馈等量强化所有节点，权重占比恒定不变，兴趣图谱永远无法分化。
  if (pushed && messageId && meta.matchedTopics?.length) {
    registerSpeakTopics(messageId, meta.matchedTopics);
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
