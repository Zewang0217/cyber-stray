import { describe, test, expect, beforeEach } from 'vitest';
import { QQBotChannel } from './channel.js';
import type { ChannelEvent, QQBotChannelConfig } from '../types.js';

process.env.QQBOT_APP_ID = 'test_app';
process.env.QQBOT_APP_SECRET = 'test_secret';

describe('QQBotChannel target tracking', () => {
  let channel: QQBotChannel;
  let events: ChannelEvent[];

  beforeEach(() => {
    channel = new QQBotChannel();
    events = [];
    channel.setEventHandler((e) => events.push(e));
  });

  const config: QQBotChannelConfig = {
    enabled: true,
    pushMode: 'c2c_group',
    receiveMode: 'ws_gateway',
  };

  test('send fails without known recipients before start', async () => {
    await channel.init(config);
    const result = await channel.send('test');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('send succeeds after recording targets', async () => {
    await channel.init(config);
    const result = await channel.send('hello');
    expect(result.success).toBe(false);
    expect(result.channelId).toBe('qqbot');
  });
});
