import type { ChannelProtocol, ChannelEvent, SendResult, ChannelStatus, FeishuChannelConfig, ChannelReactionEvent } from '../types.js';
import { consola } from '../../logger.js';
import { createLarkChannel, type ReactionEvent } from '@larksuiteoapi/node-sdk';

const logger = consola.withTag('FeishuChannel');

interface FeishuCard {
  msg_type: 'interactive';
  card: FeishuCardContent;
}

interface FeishuCardContent {
  config: { wide_screen_mode: boolean };
  header: { title: { tag: 'plain_text'; content: string }; template: string };
  elements: FeishuElement[];
}

type FeishuElement = FeishuMarkdownElement | FeishuHrElement | FeishuNoteElement;

interface FeishuMarkdownElement { tag: 'markdown'; content: string }
interface FeishuHrElement { tag: 'hr' }
interface FeishuNoteElement { tag: 'note'; elements: FeishuPlainText[] }
interface FeishuPlainText { tag: 'plain_text'; content: string }

function buildFeedbackCard(content: string, _messageId?: string): FeishuCard {
  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: '🐱 赛博街溜子' },
        template: 'blue',
      },
      elements: [
        { tag: 'markdown', content },
        { tag: 'hr' },
        {
          tag: 'note',
          elements: [{ tag: 'plain_text', content: '💡 用表情回应我：👍 喜欢 | 👎 不喜欢' }],
        },
      ],
    },
  };
}

function buildSimpleText(content: string): { msg_type: 'text'; content: { text: string } } {
  return { msg_type: 'text', content: { text: content } };
}

export class FeishuChannel implements ChannelProtocol {
  readonly id = 'feishu' as const;
  readonly name = 'Feishu';

  private channelConfig: FeishuChannelConfig | null = null;
  private status: ChannelStatus = 'uninitialized';
  private lastError: string | null = null;
  private eventHandler: ((event: ChannelEvent) => void) | null = null;

  private larkChannel: ReturnType<typeof createLarkChannel> | null = null;

  async init(config: FeishuChannelConfig): Promise<void> {
    this.channelConfig = config;
    this.status = 'disconnected';
  }

  async start(): Promise<void> {
    if (!this.channelConfig) throw new Error('FeishuChannel not initialized');
    this.status = 'connecting';

    if (this.channelConfig.receiveMode !== 'reaction') {
      this.status = 'connected';
      this.emitStatus('connected');
      return;
    }

    const appId = process.env.LARK_APP_ID;
    const appSecret = process.env.LARK_APP_SECRET;

    if (!appId || !appSecret) {
      logger.info('未配置 LARK_APP_ID/LARK_APP_SECRET，跳过飞书事件订阅');
      this.status = 'connected';
      this.emitStatus('connected');
      return;
    }

    logger.info('初始化飞书事件订阅...', { appId });

    this.larkChannel = createLarkChannel({ appId, appSecret });

    this.larkChannel.on('reaction', async (evt: ReactionEvent) => {
      logger.info('收到表情事件', {
        emojiType: evt.emojiType,
        action: evt.action,
        messageId: evt.messageId,
        operator: evt.operator.openId,
      });

      if (evt.action !== 'added') return;

      const emoji = evt.emojiType === 'thumbs_up' ? '👍' : evt.emojiType === 'thumbs_down' ? '👎' : null;
      if (!emoji) return;

      if (this.eventHandler) {
        this.eventHandler({
          type: 'reaction',
          channelId: 'feishu',
          emoji,
          action: 'added',
          messageId: evt.messageId,
          userId: evt.operator.openId,
          raw: evt,
        } satisfies ChannelReactionEvent);
      }
    });

    try {
      await this.larkChannel.connect();
      this.status = 'connected';
      this.emitStatus('connected');
      logger.success('飞书事件订阅已启动（表情互动反馈）');
    } catch (error) {
      this.status = 'error';
      this.lastError = String(error);
      this.emitStatus('error', String(error));
      logger.error('FeishuChannel start failed', { error: String(error) });
    }
  }

  async stop(): Promise<void> {
    if (this.larkChannel) {
      logger.info('关闭飞书事件订阅连接');
      await this.larkChannel.disconnect();
      this.larkChannel = null;
    }
    this.status = 'disconnected';
  }

  async send(content: string): Promise<SendResult> {
    try {
      const messageId = await this.sendFeishuMessage(content);
      return { success: true, channelId: 'feishu', messageId };
    } catch (error) {
      return { success: false, channelId: 'feishu', error: String(error) };
    }
  }

  setEventHandler(handler: (event: ChannelEvent) => void): void {
    this.eventHandler = handler;
  }

  getStatus(): ChannelStatus { return this.status; }
  getLastError(): string | null { return this.lastError; }

  private getOrCreateLarkChannel(): ReturnType<typeof createLarkChannel> {
    if (!this.larkChannel) {
      const appId = process.env.LARK_APP_ID;
      const appSecret = process.env.LARK_APP_SECRET;

      if (!appId || !appSecret) {
        throw new Error('未配置 LARK_APP_ID/LARK_APP_SECRET，无法使用 LarkChannel');
      }

      this.larkChannel = createLarkChannel({ appId, appSecret });
      logger.info('LarkChannel 实例已创建');
    }
    return this.larkChannel;
  }

  private async sendViaLarkChannel(content: string): Promise<string | undefined> {
    const chatId = this.channelConfig?.chatId;

    if (!chatId) {
      logger.warn('未配置 feishu.chatId，消息可能无法发送');
    }

    const ch = this.getOrCreateLarkChannel();
    const result = await ch.send(chatId || 'unknown', { markdown: content });

    logger.success('LarkChannel 消息发送成功', { messageId: result.messageId });
    return result.messageId;
  }

  private async sendViaWebhook(content: string, useCard = false): Promise<string | undefined> {
    const webhook = process.env.FEISHU_WEBHOOK;
    if (!webhook) {
      throw new Error('未配置 FEISHU_WEBHOOK');
    }

    let body: object;

    if (useCard && process.env.LARK_APP_ID && process.env.LARK_APP_SECRET) {
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      body = buildFeedbackCard(content, messageId);
      logger.debug('使用卡片消息格式（Webhook）', { messageId });
    } else {
      body = buildSimpleText(content);
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

  private async sendFeishuMessage(content: string): Promise<string | undefined> {
    const pushMode = this.channelConfig?.pushMode || 'lark_channel';
    const canUseLarkChannel = !!(process.env.LARK_APP_ID && process.env.LARK_APP_SECRET);

    if (pushMode === 'lark_channel' && canUseLarkChannel) {
      return this.sendViaLarkChannel(content);
    } else if (process.env.FEISHU_WEBHOOK) {
      logger.info('回退到 Webhook 发送方式');
      return this.sendViaWebhook(content, canUseLarkChannel);
    } else {
      throw new Error('无可用的飞书发送方式');
    }
  }

  private emitStatus(status: ChannelStatus, detail?: string): void {
    if (this.eventHandler) {
      this.eventHandler({ type: 'status_change', channelId: 'feishu', status, detail });
    }
  }
}

export const feishuChannel = new FeishuChannel();
