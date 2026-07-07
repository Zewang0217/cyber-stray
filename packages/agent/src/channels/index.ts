export type {
  ChannelId,
  ChannelStatus,
  ChannelProtocol,
  ChannelEvent,
  ChannelMessageEvent,
  ChannelReactionEvent,
  ChannelStatusEvent,
  ChannelRelationshipEvent,
  SendOptions,
  SendResult,
  ChannelsConfig,
  FeishuChannelConfig,
  QQBotChannelConfig,
  AgentQQMailChannelConfig,
  TelegramChannelConfig,
} from './types.js';

export { ChannelRegistry } from './registry.js';
export { ChannelManager } from './manager.js';

import { ChannelRegistry } from './registry.js';
import { ChannelManager } from './manager.js';
import type { ChannelsConfig } from './types.js';

let instance: ChannelManager | null = null;

export function getChannelManager(): ChannelManager {
  if (!instance) throw new Error('ChannelManager not initialized — call initChannelManager(config) first');
  return instance;
}

export async function initChannelManager(config: ChannelsConfig): Promise<void> {
  const registry = new ChannelRegistry();
  instance = new ChannelManager(registry, config);
  await instance.init();
}
