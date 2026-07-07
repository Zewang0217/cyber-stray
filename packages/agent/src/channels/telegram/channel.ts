import type { ChannelProtocol, ChannelEvent, SendResult, ChannelStatus, TelegramChannelConfig } from '../types.js';
import { consola } from '../../logger.js';

const logger = consola.withTag('Telegram');

export class TelegramChannel implements ChannelProtocol {
  readonly id = 'telegram' as const;
  readonly name = 'Telegram';
  private status: ChannelStatus = 'uninitialized';
  private eventHandler: ((event: ChannelEvent) => void) | null = null;

  async init(config: TelegramChannelConfig): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) throw new Error('Telegram requires TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID');
    this.status = 'connected';
  }

  async start(): Promise<void> { this.status = 'connected'; }
  async stop(): Promise<void> { this.status = 'disconnected'; }

  async send(content: string): Promise<SendResult> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return { success: false, channelId: 'telegram', error: 'Not configured' };
    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: content, parse_mode: 'HTML' }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { ok?: boolean; description?: string; result?: { message_id?: number } };
      if (!data.ok) throw new Error(data.description ?? 'unknown');
      logger.success('Telegram sent');
      return { success: true, channelId: 'telegram', messageId: String(data.result?.message_id ?? '') };
    } catch (error) {
      return { success: false, channelId: 'telegram', error: String(error) };
    }
  }

  setEventHandler(handler: (event: ChannelEvent) => void): void { this.eventHandler = handler; }
  getStatus(): ChannelStatus { return this.status; }
}

export const telegramChannel = new TelegramChannel();
