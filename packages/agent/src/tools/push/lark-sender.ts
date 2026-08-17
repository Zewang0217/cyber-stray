/**
 * 飞书消息发送模块
 *
 * 支持两种发送方式：
 * 1. LarkChannel（机器人双向）- 默认
 * 2. Webhook（传统方式）
 */

import { createLarkChannel, type SendResult } from '@larksuiteoapi/node-sdk';
import { consola } from '../../logger.js';
import { getConfig } from '../../config.js';

const logger = consola.withTag('feishu-sender');

/** LarkChannel 实例（按 appId 键化懒加载——租户各自 secrets 不串实例） */
const channels = new Map<string, ReturnType<typeof createLarkChannel>>();

/**
 * 获取 LarkChannel 实例
 */
function getChannel(): ReturnType<typeof createLarkChannel> {
  const cfg = getConfig();
  const appId = cfg.larkAppId;
  const appSecret = cfg.larkAppSecret;

  if (!appId || !appSecret) {
    throw new Error('未配置 LARK_APP_ID/LARK_APP_SECRET，无法使用 LarkChannel');
  }

  const key = `${appId}:${appSecret}`;
  let ch = channels.get(key);
  if (!ch) {
    ch = createLarkChannel({ appId, appSecret });
    channels.set(key, ch);
    logger.info('LarkChannel 实例已创建');
  }
  return ch;
}

/**
 * 使用 LarkChannel 发送消息
 *
 * @param content 消息内容
 * @returns 消息 ID
 */
async function sendViaLarkChannel(content: string): Promise<string | undefined> {
  const chatId = getConfig().feishu?.chatId;

  if (!chatId) {
    logger.warn('未配置 feishu.chatId，消息可能无法发送');
  }

  const ch = getChannel();

  // 使用 markdown 格式发送
  const result = await ch.send(chatId || 'unknown', {
    markdown: content,
  });

  logger.success('LarkChannel 消息发送成功', { messageId: result.messageId });
  return result.messageId;
}

/**
 * 使用 Webhook 发送消息
 *
 * @param content 消息内容
 * @param useCard 是否使用卡片格式
 * @returns 消息 ID（Webhook 不返回消息 ID）
 */
async function sendViaWebhook(content: string, useCard = false): Promise<string | undefined> {
  const cfg = getConfig();
  const webhook = cfg.feishuWebhook;
  if (!webhook) {
    throw new Error('未配置 FEISHU_WEBHOOK');
  }

  let body: object;

  if (useCard && cfg.larkAppId && cfg.larkAppSecret) {
    // 使用卡片格式（需要 LarkChannel 的 appId/appSecret）
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    const { buildFeedbackCard } = await import('./feishu-card.js');
    body = buildFeedbackCard(content, messageId);
    logger.debug('使用卡片消息格式（Webhook）', { messageId });
  } else {
    // 使用纯文本
    body = {
      msg_type: 'text',
      content: { text: content },
    };
    logger.debug('使用纯文本消息格式（Webhook）');
  }

  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`飞书 Webhook 推送失败: HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    code?: number;
    msg?: string;
    data?: { message_id?: string };
  };

  if (data.code !== 0) {
    throw new Error(`飞书 Webhook 推送失败: ${data.msg ?? '未知错误'}`);
  }

  logger.success('Webhook 消息发送成功');
  return data.data?.message_id;
}

/**
 * 发送飞书消息
 *
 * 根据配置选择发送方式：
 * - lark_channel: 使用 LarkChannel（默认，需要 LARK_APP_ID/SECRET）
 * - webhook: 使用传统 Webhook（需要 FEISHU_WEBHOOK）
 *
 * @param content 消息内容
 * @returns 消息 ID
 */
export async function sendFeishuMessage(content: string): Promise<string | undefined> {
  const cfg = getConfig();
  const pushMode = cfg.feishu?.pushMode || 'lark_channel';

  // 检查 LarkChannel 是否可用
  const canUseLarkChannel = !!(cfg.larkAppId && cfg.larkAppSecret);

  if (pushMode === 'lark_channel' && canUseLarkChannel) {
    return sendViaLarkChannel(content);
  } else if (cfg.feishuWebhook) {
    // 回退到 Webhook
    logger.info('回退到 Webhook 发送方式');
    return sendViaWebhook(content, canUseLarkChannel);
  } else {
    throw new Error('无可用的飞书发送方式');
  }
}

/**
 * 获取 LarkChannel 实例（供外部使用，如发送卡片）。
 * 返回当前配置对应的实例；未配置时返回 null。
 */
export function getLarkChannel(): ReturnType<typeof createLarkChannel> | null {
  const cfg = getConfig();
  if (!cfg.larkAppId || !cfg.larkAppSecret) return null;
  return getChannel();
}
