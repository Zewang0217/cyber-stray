import { consola } from '../logger.js';
import type { ChannelId, ChannelProtocol, ChannelEvent, SendResult, ChannelStatus, ChannelsConfig } from './types.js';
import type { ChannelRegistry } from './registry.js';

const logger = consola.withTag('ChannelManager');
type EventHandler = (event: ChannelEvent) => void;

export class ChannelManager {
  private registry: ChannelRegistry;
  private config: ChannelsConfig;
  private handlers: EventHandler[] = [];
  private startedChannels: ChannelProtocol[] = [];

  constructor(registry: ChannelRegistry, config: ChannelsConfig) {
    this.registry = registry;
    this.config = config;
  }

  async init(): Promise<void> {
    const enabled = this.registry.listEnabled(this.config);
    for (const channel of enabled) {
      const chConfig = this.config[channel.id];
      try {
        await channel.init(chConfig);
        channel.setEventHandler((event: ChannelEvent) => this.emitEvent(event));
        await channel.start();
        this.startedChannels.push(channel);
        logger.success(`channel [${channel.id}] started`);
      } catch (error) {
        logger.warn(`channel [${channel.id}] init/start failed (not blocking)`, { error: String(error) });
      }
    }
  }

  async broadcast(content: string): Promise<SendResult[]> {
    const results: SendResult[] = [];
    for (const channel of this.startedChannels) {
      try {
        const result = await channel.send(content);
        results.push(result);
      } catch (error) {
        results.push({ success: false, channelId: channel.id, error: String(error) });
      }
    }
    return results;
  }

  async sendTo(channelId: ChannelId, content: string): Promise<SendResult> {
    const channel = this.registry.get(channelId);
    if (!channel) throw new Error(`Channel not found: ${channelId}`);
    return channel.send(content);
  }

  onEvent(handler: EventHandler): void {
    this.handlers.push(handler);
  }

  offEvent(handler: EventHandler): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  async shutdown(): Promise<void> {
    for (const channel of this.startedChannels) {
      try {
        await channel.stop();
        logger.info(`channel [${channel.id}] stopped`);
      } catch (error) {
        logger.warn(`channel [${channel.id}] stop failed`, { error: String(error) });
      }
    }
    this.startedChannels = [];
  }

  getStatuses(): Map<ChannelId, ChannelStatus> {
    const map = new Map<ChannelId, ChannelStatus>();
    for (const channel of this.registry.list()) {
      map.set(channel.id, channel.getStatus());
    }
    return map;
  }

  private emitEvent(event: ChannelEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (error) {
        logger.error('channel event handler error', { error: String(error) });
      }
    }
  }
}
