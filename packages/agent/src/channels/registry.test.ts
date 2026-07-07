import { describe, it, expect, beforeEach } from 'vitest';
import { ChannelRegistry } from './registry.js';
import type { ChannelId, ChannelProtocol, ChannelStatus, ChannelsConfig } from './types.js';

function makeMockChannel(id: ChannelId, name: string): ChannelProtocol {
  let status: ChannelStatus = 'uninitialized';
  return {
    id,
    name,
    async init(_config: ChannelsConfig[ChannelId]): Promise<void> {
      status = 'connected';
    },
    async start(): Promise<void> {},
    async stop(): Promise<void> {
      status = 'disconnected';
    },
    async send(): Promise<{ success: boolean; channelId: ChannelId }> {
      return { success: true, channelId: id };
    },
    setEventHandler(): void {},
    getStatus(): ChannelStatus {
      return status;
    },
  };
}

function makeChannelsConfig(overrides: Partial<Record<ChannelId, { enabled: boolean }>> = {}): ChannelsConfig {
  return {
    feishu: { enabled: true, pushMode: 'webhook', receiveMode: 'reaction', chatId: 'test', ...overrides.feishu },
    qqbot: { enabled: true, pushMode: 'c2c', receiveMode: 'ws_gateway', ...overrides.qqbot },
    'agent-qq-mail': { enabled: true, pushMode: 'push', receiveMode: 'imap', ...overrides['agent-qq-mail'] },
    telegram: { enabled: true, pushMode: 'bot_api', ...overrides.telegram },
  };
}

describe('ChannelRegistry', () => {
  let registry: ChannelRegistry;

  beforeEach(() => {
    registry = new ChannelRegistry();
  });

  it('should register and retrieve a channel by id', () => {
    const channel = makeMockChannel('feishu', 'Feishu');
    registry.register(channel);
    expect(registry.get('feishu')).toBe(channel);
  });

  it('should return undefined for unknown channel id', () => {
    expect(registry.get('feishu')).toBeUndefined();
  });

  it('should list all registered channels', () => {
    const feishu = makeMockChannel('feishu', 'Feishu');
    const telegram = makeMockChannel('telegram', 'Telegram');
    registry.register(feishu);
    registry.register(telegram);
    expect(registry.list()).toHaveLength(2);
    expect(registry.list()).toContain(feishu);
    expect(registry.list()).toContain(telegram);
  });

  it('should list only enabled channels', () => {
    const feishu = makeMockChannel('feishu', 'Feishu');
    const telegram = makeMockChannel('telegram', 'Telegram');
    const qqbot = makeMockChannel('qqbot', 'QQBot');
    registry.register(feishu);
    registry.register(telegram);
    registry.register(qqbot);

    const config = makeChannelsConfig({ telegram: { enabled: false } });
    const enabled = registry.listEnabled(config);
    expect(enabled).toHaveLength(2);
    expect(enabled).toContain(feishu);
    expect(enabled).toContain(qqbot);
    expect(enabled).not.toContain(telegram);
  });

  it('should return empty list when all channels are disabled', () => {
    const feishu = makeMockChannel('feishu', 'Feishu');
    registry.register(feishu);

    const config = makeChannelsConfig({ feishu: { enabled: false } });
    expect(registry.listEnabled(config)).toHaveLength(0);
  });

  it('should return empty list when no channels registered', () => {
    const config = makeChannelsConfig();
    expect(registry.listEnabled(config)).toHaveLength(0);
  });

  it('should overwrite when registering same id twice', () => {
    const first = makeMockChannel('feishu', 'Feishu v1');
    const second = makeMockChannel('feishu', 'Feishu v2');
    registry.register(first);
    registry.register(second);
    expect(registry.get('feishu')).toBe(second);
    expect(registry.list()).toHaveLength(1);
  });
});
