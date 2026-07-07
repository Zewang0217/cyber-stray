export type ChannelId = 'feishu' | 'qqbot' | 'agent-qq-mail' | 'telegram';
export type ChannelStatus = 'uninitialized' | 'disconnected' | 'connecting' | 'connected' | 'error';

export interface SendOptions {
  replyTo?: string;
}

export interface SendResult {
  success: boolean;
  channelId: ChannelId;
  messageId?: string;
  error?: string;
}

export type ChannelEvent =
  | ChannelMessageEvent
  | ChannelReactionEvent
  | ChannelStatusEvent
  | ChannelRelationshipEvent;

export interface ChannelMessageEvent {
  type: 'message';
  channelId: ChannelId;
  content: string;
  sender: string;
  messageId: string;
  replyTo?: string;
  raw: unknown;
}

export interface ChannelReactionEvent {
  type: 'reaction';
  channelId: ChannelId;
  emoji: string;
  action: 'added' | 'removed';
  messageId: string;
  userId: string;
  raw: unknown;
}

export interface ChannelStatusEvent {
  type: 'status_change';
  channelId: ChannelId;
  status: ChannelStatus;
  detail?: string;
}

export interface ChannelRelationshipEvent {
  type: 'relationship';
  channelId: ChannelId;
  action: 'friend_add' | 'friend_delete' | 'group_join' | 'group_leave';
  userId?: string;
  groupId?: string;
  raw: unknown;
}

export interface ChannelProtocol {
  readonly id: ChannelId;
  readonly name: string;
  init(config: Record<string, unknown>): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(content: string, options?: SendOptions): Promise<SendResult>;
  setEventHandler(handler: (event: ChannelEvent) => void): void;
  getStatus(): ChannelStatus;
  getLastError?(): string | null;
}

export interface ChannelsConfig {
  feishu: FeishuChannelConfig;
  qqbot: QQBotChannelConfig;
  'agent-qq-mail': AgentQQMailChannelConfig;
  telegram: TelegramChannelConfig;
}

export interface FeishuChannelConfig {
  enabled: boolean;
  pushMode: 'lark_channel' | 'webhook';
  receiveMode: 'reaction' | 'none';
  chatId: string;
}

export interface QQBotChannelConfig {
  enabled: boolean;
  pushMode: 'c2c' | 'c2c_group';
  receiveMode: 'ws_gateway' | 'none';
}

export interface AgentQQMailChannelConfig {
  enabled: boolean;
  pushMode: string;
  receiveMode: string;
}

export interface TelegramChannelConfig {
  enabled: boolean;
  pushMode: 'bot_api';
}
