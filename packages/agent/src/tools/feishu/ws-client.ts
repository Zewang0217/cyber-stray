/**
 * 飞书事件订阅客户端
 *
 * 使用 @larksuiteoapi/node-sdk 的 LarkChannel 建立长连接
 * 通过表情互动（👍👎）接收用户反馈
 *
 * 注意：飞书自定义机器人 Webhook 推送不支持卡片按钮回调，
 * 因此改用表情互动事件。用户对消息添加/移除 👍 或 👎 时触发。
 */

import { createLarkChannel, type ReactionEvent } from '@larksuiteoapi/node-sdk';
import { consola } from '../../logger.js';
import { processFeedback } from '../../memory/feedback-pipeline.js';

const logger = consola.withTag('feishu-ws');

/** LarkChannel 实例 */
let channel: ReturnType<typeof createLarkChannel> | null = null;
/** 连接状态 */
let connected = false;

/**
 * 初始化飞书事件订阅
 */
export async function initFeishuWS(): Promise<void> {
  if (connected) {
    logger.info('飞书事件订阅已连接，跳过');
    return;
  }

  const appId = process.env.LARK_APP_ID;
  const appSecret = process.env.LARK_APP_SECRET;

  if (!appId || !appSecret) {
    logger.info('未配置 LARK_APP_ID/LARK_APP_SECRET，跳过飞书事件订阅');
    return;
  }

  logger.info('初始化飞书事件订阅...', { appId });

  // 创建 LarkChannel
  channel = createLarkChannel({
    appId,
    appSecret,
  });

  // 注册表情互动事件处理
  // 用户对消息添加 👍 → like 反馈
  // 用户对消息添加 👎 → dislike 反馈
  channel.on('reaction', async (evt: ReactionEvent) => {
    logger.info('收到表情事件', {
      emojiType: evt.emojiType,
      action: evt.action,
      messageId: evt.messageId,
      operator: evt.operator.openId,
    });

    // 只处理添加表情（忽略移除）
    if (evt.action !== 'added') {
      return;
    }

    // 映射表情类型到反馈类型
    // 👍 对应 thumbs_up，👎 对应 thumbs_down
    const feedbackType = evt.emojiType === 'thumbs_up'
      ? 'like'
      : evt.emojiType === 'thumbs_down'
      ? 'dislike'
      : null;

    if (feedbackType) {
      try {
        // Phase 3: 使用反馈管道（记录 + 画像 + 兴趣加权 + 心情）
        const result = await processFeedback(
          feedbackType,
          evt.messageId,
          evt.operator.openId,
        );

        logger.success('反馈处理完成', {
          type: feedbackType,
          userId: evt.operator.openId,
          messageId: evt.messageId,
          topicsMatched: result.topicsMatched,
          matchedTopics: result.matchedTopics,
          profileUpdated: result.profileUpdated,
          interestReinforced: result.interestReinforced,
        });
      } catch (error) {
        logger.error('处理反馈失败', { error });
      }
    }
  });

  // 连接 WebSocket
  try {
    await channel.connect();
    connected = true;
    logger.success('飞书事件订阅已启动（表情互动反馈）');
  } catch (error) {
    logger.error('飞书事件订阅连接失败', { error });
    connected = false;
  }
}

/**
 * 获取 LarkChannel 实例
 */
export function getChannel(): ReturnType<typeof createLarkChannel> | null {
  return channel;
}

/**
 * 检查是否已连接
 */
export function isConnected(): boolean {
  return connected;
}

/**
 * 关闭连接
 */
export async function closeFeishuWS(): Promise<void> {
  if (channel) {
    logger.info('关闭飞书事件订阅连接');
    await channel.disconnect();
    channel = null;
    connected = false;
  }
}
