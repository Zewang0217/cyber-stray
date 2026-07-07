import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChannelManager } from './manager.js';
import { ChannelRegistry } from './registry.js';
import type { ChannelId, ChannelProtocol, ChannelEvent, ChannelStatus, SendResult, ChannelsConfig } from './types.js';

function makeMockChannel(
  id: ChannelId,
  name: string,
  opts: { initFails?: boolean; startFails?: boolean; stopFails?: boolean; sendFails?: boolean } = {},
): ChannelProtocol & {
  _lastSendContent?: string;
  _started: boolean;
  _stopped: boolean;
  _eventHandler?: (event: ChannelEvent) => void;
} {
  let status: ChannelStatus = 'uninitialized';
  const mock: ReturnType<typeof makeMockChannel> = {
    id,
    name,
    _started: false,
    _stopped: false,
    async init(_config: ChannelsConfig[ChannelId]): Promise<void> {
      if (opts.initFails) throw new Error('init failed');
      status = 'disconnected';
    },
    async start(): Promise<void> {
      if (opts.startFails) throw new Error('start failed');
      status = 'connected';
      mock._started = true;
    },
    async stop(): Promise<void> {
      if (opts.stopFails) throw new Error('stop failed');
      status = 'disconnected';
      mock._stopped = true;
    },
    async send(content: string): Promise<SendResult> {
      if (opts.sendFails) throw new Error('send failed');
      mock._lastSendContent = content;
      return { success: true, channelId: id, messageId: `${id}-msg-1` };
    },
    setEventHandler(handler: (event: ChannelEvent) => void): void {
      mock._eventHandler = handler;
    },
    getStatus(): ChannelStatus {
      return status;
    },
  };
  return mock;
}

function makeAllEnabledConfig(): ChannelsConfig {
  return {
    feishu: { enabled: true, pushMode: 'webhook', receiveMode: 'reaction', chatId: 'test-chat' },
    qqbot: { enabled: true, pushMode: 'c2c', receiveMode: 'ws_gateway' },
    'agent-qq-mail': { enabled: true, pushMode: 'push', receiveMode: 'imap' },
    telegram: { enabled: true, pushMode: 'bot_api' },
  };
}

describe('ChannelManager', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should init starts all enabled channels', async () => {
    const registry = new ChannelRegistry();
    const feishu = makeMockChannel('feishu', 'Feishu');
    const telegram = makeMockChannel('telegram', 'Telegram');
    registry.register(feishu);
    registry.register(telegram);

    const config = makeAllEnabledConfig();
    const manager = new ChannelManager(registry, config);
    await manager.init();

    expect(feishu._started).toBe(true);
    expect(telegram._started).toBe(true);
  });

  it('should init does not start disabled channels', async () => {
    const registry = new ChannelRegistry();
    const feishu = makeMockChannel('feishu', 'Feishu');
    const telegram = makeMockChannel('telegram', 'Telegram');
    registry.register(feishu);
    registry.register(telegram);

    const config = makeAllEnabledConfig();
    config.telegram.enabled = false;
    const manager = new ChannelManager(registry, config);
    await manager.init();

    expect(feishu._started).toBe(true);
    expect(telegram._started).toBe(false);
  });

  it('should broadcast sends to all started channels', async () => {
    const registry = new ChannelRegistry();
    const feishu = makeMockChannel('feishu', 'Feishu');
    const telegram = makeMockChannel('telegram', 'Telegram');
    registry.register(feishu);
    registry.register(telegram);

    const config = makeAllEnabledConfig();
    const manager = new ChannelManager(registry, config);
    await manager.init();

    const results = await manager.broadcast('Hello world');
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
    expect(feishu._lastSendContent).toBe('Hello world');
    expect(telegram._lastSendContent).toBe('Hello world');
  });

  it('should broadcast returns per-channel results with errors', async () => {
    const registry = new ChannelRegistry();
    const feishu = makeMockChannel('feishu', 'Feishu', { sendFails: true });
    const telegram = makeMockChannel('telegram', 'Telegram');
    registry.register(feishu);
    registry.register(telegram);

    const config = makeAllEnabledConfig();
    const manager = new ChannelManager(registry, config);
    await manager.init();

    const results = await manager.broadcast('test');
    expect(results).toHaveLength(2);
    const feishuResult = results.find((r) => r.channelId === 'feishu');
    const telegramResult = results.find((r) => r.channelId === 'telegram');
    expect(feishuResult!.success).toBe(false);
    expect(feishuResult!.error).toBe('Error: send failed');
    expect(telegramResult!.success).toBe(true);
  });

  it('should sendTo sends to specific channel', async () => {
    const registry = new ChannelRegistry();
    const feishu = makeMockChannel('feishu', 'Feishu');
    registry.register(feishu);

    const config = makeAllEnabledConfig();
    const manager = new ChannelManager(registry, config);

    const result = await manager.sendTo('feishu', 'direct message');
    expect(result.success).toBe(true);
    expect(result.channelId).toBe('feishu');
    expect(feishu._lastSendContent).toBe('direct message');
  });

  it('should sendTo throws for unknown channel', async () => {
    const registry = new ChannelRegistry();
    const config = makeAllEnabledConfig();
    const manager = new ChannelManager(registry, config);

    await expect(manager.sendTo('feishu', 'test')).rejects.toThrow('Channel not found: feishu');
  });

  it('should shutdown stops all started channels', async () => {
    const registry = new ChannelRegistry();
    const feishu = makeMockChannel('feishu', 'Feishu');
    const telegram = makeMockChannel('telegram', 'Telegram');
    registry.register(feishu);
    registry.register(telegram);

    const config = makeAllEnabledConfig();
    const manager = new ChannelManager(registry, config);
    await manager.init();

    await manager.shutdown();
    expect(feishu._stopped).toBe(true);
    expect(telegram._stopped).toBe(true);
  });

  it('should onEvent delivers channel events to handlers', async () => {
    const registry = new ChannelRegistry();
    const feishu = makeMockChannel('feishu', 'Feishu');
    registry.register(feishu);

    const config = makeAllEnabledConfig();
    const manager = new ChannelManager(registry, config);
    await manager.init();

    const received: ChannelEvent[] = [];
    manager.onEvent((evt) => received.push(evt));

    const event: ChannelEvent = {
      type: 'message',
      channelId: 'feishu',
      content: 'hello',
      sender: 'user1',
      messageId: 'msg-123',
      raw: {},
    };
    feishu._eventHandler!(event);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(event);
  });

  it('should offEvent unregisters a handler', async () => {
    const registry = new ChannelRegistry();
    const feishu = makeMockChannel('feishu', 'Feishu');
    registry.register(feishu);

    const config = makeAllEnabledConfig();
    const manager = new ChannelManager(registry, config);
    await manager.init();

    const received: ChannelEvent[] = [];
    const handler = (evt: ChannelEvent): void => { received.push(evt); };
    manager.onEvent(handler);
    manager.offEvent(handler);

    const event: ChannelEvent = {
      type: 'message',
      channelId: 'feishu',
      content: 'hello',
      sender: 'user1',
      messageId: 'msg-123',
      raw: {},
    };
    feishu._eventHandler!(event);

    expect(received).toHaveLength(0);
  });

  it('should getStatuses returns status map for all registered channels', async () => {
    const registry = new ChannelRegistry();
    const feishu = makeMockChannel('feishu', 'Feishu');
    const telegram = makeMockChannel('telegram', 'Telegram');
    registry.register(feishu);
    registry.register(telegram);

    const config = makeAllEnabledConfig();
    const manager = new ChannelManager(registry, config);
    await manager.init();

    const statuses = manager.getStatuses();
    expect(statuses.get('feishu')).toBe('connected');
    expect(statuses.get('telegram')).toBe('connected');
  });

  it('init proceeds to other channels when one init fails', async () => {
    const registry = new ChannelRegistry();
    const feishu = makeMockChannel('feishu', 'Feishu', { initFails: true });
    const telegram = makeMockChannel('telegram', 'Telegram');
    registry.register(feishu);
    registry.register(telegram);

    const config = makeAllEnabledConfig();
    const manager = new ChannelManager(registry, config);
    await manager.init();

    expect(feishu._started).toBe(false);
    expect(telegram._started).toBe(true);
  });

  it('init proceeds to other channels when one start fails', async () => {
    const registry = new ChannelRegistry();
    const feishu = makeMockChannel('feishu', 'Feishu', { startFails: true });
    const telegram = makeMockChannel('telegram', 'Telegram');
    registry.register(feishu);
    registry.register(telegram);

    const config = makeAllEnabledConfig();
    const manager = new ChannelManager(registry, config);
    await manager.init();

    expect(feishu._started).toBe(false);
    expect(telegram._started).toBe(true);
  });

  it('shutdown proceeds when stop throws', async () => {
    const registry = new ChannelRegistry();
    const feishu = makeMockChannel('feishu', 'Feishu', { stopFails: true });
    const telegram = makeMockChannel('telegram', 'Telegram');
    registry.register(feishu);
    registry.register(telegram);

    const config = makeAllEnabledConfig();
    const manager = new ChannelManager(registry, config);
    await manager.init();

    await manager.shutdown();
    expect(feishu._stopped).toBe(false);
    expect(telegram._stopped).toBe(true);
  });

  it('sendTo handles send failure', async () => {
    const registry = new ChannelRegistry();
    const feishu = makeMockChannel('feishu', 'Feishu', { sendFails: true });
    registry.register(feishu);

    const config = makeAllEnabledConfig();
    const manager = new ChannelManager(registry, config);

    await expect(manager.sendTo('feishu', 'test')).rejects.toThrow('send failed');
  });

  it('emitEvent catches handler errors', async () => {
    const registry = new ChannelRegistry();
    const feishu = makeMockChannel('feishu', 'Feishu');
    registry.register(feishu);

    const config = makeAllEnabledConfig();
    const manager = new ChannelManager(registry, config);
    await manager.init();

    const received: ChannelEvent[] = [];
    manager.onEvent(() => { throw new Error('handler error'); });
    manager.onEvent((evt) => received.push(evt));

    const event: ChannelEvent = {
      type: 'message',
      channelId: 'feishu',
      content: 'hello',
      sender: 'user1',
      messageId: 'msg-123',
      raw: {},
    };
    feishu._eventHandler!(event);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(event);
  });
});
