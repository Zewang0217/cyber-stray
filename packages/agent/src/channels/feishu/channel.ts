import type { ChannelProtocol, ChannelEvent, SendResult, ChannelStatus, FeishuChannelConfig } from '../types.js';
import { consola } from '../../logger.js';
import { sendFeishuMessage } from '../../tools/push/lark-sender.js';
import { initFeishuWS, closeFeishuWS } from '../../tools/feishu/ws-client.js';

const logger = consola.withTag('FeishuChannel');

export class FeishuChannel implements ChannelProtocol {
  readonly id = 'feishu' as const;
  readonly name = 'Feishu';

  private config: FeishuChannelConfig | null = null;
  private status: ChannelStatus = 'uninitialized';
  private lastError: string | null = null;
  private eventHandler: ((event: ChannelEvent) => void) | null = null;

  async init(config: FeishuChannelConfig): Promise<void> {
    this.config = config;
    this.status = 'disconnected';
  }

  async start(): Promise<void> {
    if (!this.config) throw new Error('FeishuChannel not initialized');
    this.status = 'connecting';
    try {
      await initFeishuWS();
      this.status = 'connected';
      this.emitStatus('connected');
    } catch (error) {
      this.status = 'error';
      this.lastError = String(error);
      this.emitStatus('error', String(error));
      logger.error('FeishuChannel start failed', { error: String(error) });
    }
  }

  async stop(): Promise<void> {
    await closeFeishuWS();
    this.status = 'disconnected';
  }

  async send(content: string): Promise<SendResult> {
    try {
      const messageId = await sendFeishuMessage(content);
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

  private emitStatus(status: ChannelStatus, detail?: string): void {
    if (this.eventHandler) {
      this.eventHandler({ type: 'status_change', channelId: 'feishu', status, detail });
    }
  }
}

export const feishuChannel = new FeishuChannel();
