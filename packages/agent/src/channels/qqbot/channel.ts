import type { ChannelProtocol, ChannelEvent, SendResult, ChannelStatus, QQBotChannelConfig } from '../types.js';
import { consola } from '../../logger.js';
import { TokenManager } from './token-manager.js';
import { MessageApi } from './api.js';
import { GatewayConnection } from './gateway.js';
import { EventDispatcher } from './dispatcher.js';
import { ReconnectManager } from './reconnect.js';

const logger = consola.withTag('QQBotChannel');

export class QQBotChannel implements ChannelProtocol {
  readonly id = 'qqbot' as const;
  readonly name = 'QQ Bot';

  private config: QQBotChannelConfig | null = null;
  private status: ChannelStatus = 'uninitialized';
  private eventHandler: ((event: ChannelEvent) => void) | null = null;

  private tokenManager: TokenManager | null = null;
  private api: MessageApi | null = null;
  private gateway: GatewayConnection | null = null;
  private reconnect: ReconnectManager | null = null;

  private knownOpenids: Set<string> = new Set();
  private knownGroupIds: Set<string> = new Set();

  async init(config: QQBotChannelConfig): Promise<void> {
    this.config = config;
    const appId = process.env.QQBOT_APP_ID;
    const appSecret = process.env.QQBOT_APP_SECRET;
    if (!appId || !appSecret) throw new Error('QQBot requires QQBOT_APP_ID + QQBOT_APP_SECRET env vars');
    this.tokenManager = new TokenManager(appId, appSecret);
    this.status = 'disconnected';
  }

  async start(): Promise<void> {
    if (!this.tokenManager) throw new Error('QQBotChannel not initialized');
    this.status = 'connecting';
    this.emitStatus('connecting');

    try {
      const token = await this.tokenManager.getToken();
      this.api = new MessageApi(() => this.tokenManager!.getToken());

      await this.connectGateway(token);
      this.reconnect = new ReconnectManager(async () => {
        const freshToken = await this.tokenManager!.getToken();
        this.api = new MessageApi(() => this.tokenManager!.getToken());
        await this.connectGateway(freshToken);
      });

      this.status = 'connected';
      this.emitStatus('connected');
    } catch (error) {
      this.status = 'error';
      throw error;
    }
  }

  private async connectGateway(token: string): Promise<void> {
    this.gateway?.disconnect();
    this.gateway = new GatewayConnection(token);
    const dispatcher = new EventDispatcher((event) => {
      this.recordTarget(event);
      this.eventHandler?.(event);
    });
    this.gateway.setEventHandlers(
      (payload) => dispatcher.dispatch(payload),
      (state) => {
        if (!state.connected) {
          this.status = 'disconnected';
          this.emitStatus('disconnected');
        }
      },
    );
    await this.gateway.connect();
  }

  async stop(): Promise<void> {
    this.gateway?.disconnect();
    this.status = 'disconnected';
  }

  async send(content: string): Promise<SendResult> {
    if (!this.api) return { success: false, channelId: 'qqbot', error: 'Not connected' };

    const errors: string[] = [];
    let lastMessageId: string | undefined;

    for (const openid of this.knownOpenids) {
      try {
        const result = await this.api.sendC2CText(openid, content);
        lastMessageId = result.id;
      } catch (error) {
        errors.push(`C2C(${openid}): ${String(error)}`);
      }
    }

    for (const groupId of this.knownGroupIds) {
      try {
        const result = await this.api.sendGroupText(groupId, content);
        lastMessageId = lastMessageId ?? result.id;
      } catch (error) {
        errors.push(`Group(${groupId}): ${String(error)}`);
      }
    }

    if (lastMessageId) {
      return { success: true, channelId: 'qqbot', messageId: lastMessageId };
    }
    return { success: false, channelId: 'qqbot', error: errors.join('; ') || 'No known recipients' };
  }

  setEventHandler(handler: (event: ChannelEvent) => void): void { this.eventHandler = handler; }
  getStatus(): ChannelStatus { return this.status; }

  private recordTarget(event: ChannelEvent): void {
    if (event.type === 'message') {
      this.knownOpenids.add(event.sender);
      const raw = event.raw as { group_openid?: string };
      if (raw.group_openid) {
        this.knownGroupIds.add(raw.group_openid);
      }
    } else if (event.type === 'relationship') {
      if (event.action === 'friend_add' && event.userId) {
        this.knownOpenids.add(event.userId);
      } else if (event.action === 'friend_delete' && event.userId) {
        this.knownOpenids.delete(event.userId);
      } else if (event.action === 'group_join' && event.groupId) {
        this.knownGroupIds.add(event.groupId);
      } else if (event.action === 'group_leave' && event.groupId) {
        this.knownGroupIds.delete(event.groupId);
      }
    }
  }

  private emitStatus(status: ChannelStatus, detail?: string): void {
    if (this.eventHandler) {
      this.eventHandler({ type: 'status_change', channelId: 'qqbot', status, detail });
    }
  }
}

export const qqbotChannel = new QQBotChannel();
