import type { ChannelId, ChannelProtocol, ChannelsConfig } from './types.js';

export class ChannelRegistry {
  private channels = new Map<ChannelId, ChannelProtocol>();

  register(channel: ChannelProtocol): void {
    this.channels.set(channel.id, channel);
  }

  get(id: ChannelId): ChannelProtocol | undefined {
    return this.channels.get(id);
  }

  list(): ChannelProtocol[] {
    return [...this.channels.values()];
  }

  listEnabled(config: ChannelsConfig): ChannelProtocol[] {
    return this.list().filter((ch) => {
      const chConfig = config[ch.id];
      return chConfig !== undefined && chConfig.enabled;
    });
  }
}
