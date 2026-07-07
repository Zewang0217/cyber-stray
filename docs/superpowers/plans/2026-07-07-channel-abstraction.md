# Channel Abstraction Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abstract Feishu/QQ Bot/Agent QQ Mail/Telegram behind a unified `ChannelProtocol` interface with `ChannelManager` lifecycle management and normalized `ChannelEvent` streams.

**Architecture:** Three-layer pattern — `ChannelProtocol` interface defines the contract, `ChannelRegistry` manages registration, `ChannelManager` handles init/start/broadcast/shutdown/event routing. Each channel is a self-contained module implementing `ChannelProtocol`. Feishu migrates progressively by wrapping existing modules, QQ Bot and Agent QQ Mail are new implementations, Telegram is extracted from `speak.ts`.

**Tech Stack:** TypeScript strict, `verbatimModuleSyntax`, `.js` import extensions, vitest v3 with `globals: true`, Vercel AI SDK v6 (unchanged), `@larksuiteoapi/node-sdk` (unchanged), Node.js `ws` or `isomorphic-ws` for QQ Bot WebSocket.

---

## File Structure

```
packages/agent/src/channels/
├── types.ts                    # NEW: all channel types
├── registry.ts                 # NEW: ChannelRegistry
├── manager.ts                  # NEW: ChannelManager + singleton export
│
├── feishu/
│   └── channel.ts             # NEW: FeishuChannel (wraps existing modules)
│
├── qqbot/
│   ├── channel.ts             # NEW: QQBotChannel
│   ├── token-manager.ts       # NEW: OAuth2 token cache/refresh
│   ├── api.ts                 # NEW: REST send methods
│   ├── gateway.ts             # NEW: WebSocket connection + heartbeat
│   ├── dispatcher.ts          # NEW: event type routing
│   └── reconnect.ts           # NEW: exponential backoff
│
├── agent-qq-mail/
│   ├── channel.ts             # NEW: AgentQQMailChannel
│   └── cli.ts                 # NEW: agently-cli wrapper
│
└── telegram/
    └── channel.ts             # NEW: TelegramChannel

Files modified:
- packages/agent/src/types.ts                  # add ChannelsConfig, ChannelId to AgentConfig
- packages/agent/src/config.ts                 # read channels.* config with old-field fallback
- packages/agent/src/tools/push/speak.ts       # replace hardcoded dispatch with ChannelManager.broadcast()
- packages/agent/src/index.ts                  # replace initFeishuWS()/closeFeishuWS() with ChannelManager
- packages/agent/src/memory/feedback-pipeline.ts  # add processChannelEvent() wrapper
- data/agent-config.json                       # add channels section (manual edit)
- .env.example                                 # add QQBOT_APP_ID, QQBOT_APP_SECRET, AGENTQQMAIL_EMAIL

Files deprecated (Phase 2) → deleted (Phase 6):
- packages/agent/src/tools/feishu/ws-client.ts
- packages/agent/src/tools/push/lark-sender.ts
- packages/agent/src/tools/push/feishu-card.ts
```

---

## Phase 1: Core Types + Registry + Manager

### Task 1.1: Create channels/types.ts

**Files:**
- Create: `packages/agent/src/channels/types.ts`

- [ ] **Step 1: Write the types file**

All types in one file since they're highly cohesive.

```typescript
/**
 * Channel abstraction types for Cyber Stray agent.
 *
 * Defines ChannelProtocol, ChannelEvent, and supporting types
 * so all message channels (Feishu, QQ Bot, Agent QQ Mail, Telegram)
 * can be managed through a unified interface.
 */

/** Unique identifier for each channel implementation */
export type ChannelId = 'feishu' | 'qqbot' | 'agent-qq-mail' | 'telegram';

/** Channel connection lifecycle status */
export type ChannelStatus = 'uninitialized' | 'disconnected' | 'connecting' | 'connected' | 'error';

/** Options for sending a message through a channel */
export interface SendOptions {
  /** Optional reply target (e.g. QQ msg_id for passive reply routing) */
  replyTo?: string;
}

/** Result of a send operation */
export interface SendResult {
  success: boolean;
  channelId: ChannelId;
  messageId?: string;
  error?: string;
}

// ── ChannelEvent discriminated union ──

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

// ── ChannelProtocol interface ──

export interface ChannelProtocol {
  readonly id: ChannelId;
  readonly name: string;

  /** Setup with channel-specific config. Must be called before start(). */
  init(config: Record<string, unknown>): Promise<void>;

  /** Connect and begin send/receive operations. */
  start(): Promise<void>;

  /** Disconnect and release all resources. */
  stop(): Promise<void>;

  /** Send content through this channel. Returns per-channel result. */
  send(content: string, options?: SendOptions): Promise<SendResult>;

  /**
   * Register an event handler for inbound messages/reactions/status changes.
   * Called by ChannelManager during init(). Channel calls this handler
   * whenever a native event arrives that should be surfaced to the agent.
   */
  setEventHandler(handler: (event: ChannelEvent) => void): void;

  /** Current connection status. */
  getStatus(): ChannelStatus;

  /** Last error message, if any. */
  getLastError?(): string | null;
}

// ── Channel configuration types (dcouples from AgentConfig) ──

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
```

- [ ] **Step 2: Verify types compile**

```bash
pnpm --filter @cyber-stray/agent typecheck
```

Expected: `channels/types.ts` compiles without errors (no imports to resolve at this stage).

---

### Task 1.2: Create channels/registry.test.ts (TDD)

**Files:**
- Create: `packages/agent/src/channels/registry.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, test, expect, beforeEach } from 'vitest';
import type { ChannelProtocol, ChannelEvent, SendResult, ChannelsConfig, FeishuChannelConfig, QQBotChannelConfig, AgentQQMailChannelConfig, TelegramChannelConfig } from './types.js';
import { ChannelRegistry } from './registry.js';

function makeMockChannel(id: string): ChannelProtocol {
  return {
    id: id as ChannelProtocol['id'],
    name: `Mock ${id}`,
    init: async () => {},
    start: async () => {},
    stop: async () => {},
    send: async (): Promise<SendResult> => ({ success: true, channelId: id as SendResult['channelId'] }),
    setEventHandler: () => {},
    getStatus: () => 'connected' as const,
  };
}

function makeChannelsConfig(enabled: string[] = []): ChannelsConfig {
  return {
    feishu: { enabled: enabled.includes('feishu'), pushMode: 'lark_channel', receiveMode: 'reaction', chatId: '' },
    qqbot: { enabled: enabled.includes('qqbot'), pushMode: 'c2c_group', receiveMode: 'ws_gateway' },
    'agent-qq-mail': { enabled: enabled.includes('agent-qq-mail'), pushMode: 'smtp', receiveMode: 'imap' },
    telegram: { enabled: enabled.includes('telegram'), pushMode: 'bot_api' },
  };
}

describe('ChannelRegistry', () => {
  let registry: ChannelRegistry;

  beforeEach(() => {
    registry = new ChannelRegistry();
  });

  test('register and get by id', () => {
    const ch = makeMockChannel('feishu');
    registry.register(ch);
    expect(registry.get('feishu')).toBe(ch);
  });

  test('get returns undefined for unknown id', () => {
    expect(registry.get('qqbot')).toBeUndefined();
  });

  test('list returns all registered channels', () => {
    const a = makeMockChannel('feishu');
    const b = makeMockChannel('qqbot');
    registry.register(a);
    registry.register(b);
    expect(registry.list()).toHaveLength(2);
  });

  test('listEnabled returns only enabled channels', () => {
    const config = makeChannelsConfig(['feishu']);
    const feishu = makeMockChannel('feishu');
    const qqbot = makeMockChannel('qqbot');
    registry.register(feishu);
    registry.register(qqbot);
    const enabled = registry.listEnabled(config);
    expect(enabled).toHaveLength(1);
    expect(enabled[0]!.id).toBe('feishu');
  });

  test('listEnabled returns empty when all disabled', () => {
    const config = makeChannelsConfig([]);
    const ch = makeMockChannel('feishu');
    registry.register(ch);
    expect(registry.listEnabled(config)).toHaveLength(0);
  });

  test('register same id twice overwrites', () => {
    const a = makeMockChannel('feishu');
    const b = makeMockChannel('feishu');
    registry.register(a);
    registry.register(b);
    expect(registry.get('feishu')).toBe(b);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm --filter @cyber-stray/agent test -- src/channels/registry.test.ts
```

Expected: FAIL — cannot find module `./registry.js`.

---

### Task 1.3: Implement channels/registry.ts

**Files:**
- Create: `packages/agent/src/channels/registry.ts`

- [ ] **Step 1: Write the implementation**

```typescript
import type { ChannelId, ChannelProtocol, ChannelsConfig } from './types.js';

/**
 * Central registry for all channel implementations.
 * Channels are registered at import time (in channels/index.ts) and
 * discovered by ChannelManager during init.
 */
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

  /**
   * Return only channels that are marked enabled in config.
   * The config key for each channel matches its ChannelId.
   */
  listEnabled(config: ChannelsConfig): ChannelProtocol[] {
    return this.list().filter((ch) => {
      const chConfig = config[ch.id];
      return chConfig !== undefined && chConfig.enabled;
    });
  }
}
```

- [ ] **Step 2: Run tests — expect pass**

```bash
pnpm --filter @cyber-stray/agent test -- src/channels/registry.test.ts
```

Expected: All 6 tests PASS.

---

### Task 1.4: Create channels/manager.test.ts (TDD)

**Files:**
- Create: `packages/agent/src/channels/manager.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { ChannelProtocol, ChannelEvent, SendResult, ChannelsConfig, ChannelStatus } from './types.js';
import { ChannelRegistry } from './registry.js';
import { ChannelManager } from './manager.js';

type EventHandler = (event: ChannelEvent) => void;

function makeMockChannel(id: 'feishu' | 'qqbot' | 'agent-qq-mail' | 'telegram'): ChannelProtocol & {
  _lastSendContent: string;
  _eventHandler: EventHandler | null;
  _started: boolean;
  _stopped: boolean;
  _status: ChannelStatus;
} {
  return {
    id,
    name: `Mock ${id}`,
    _lastSendContent: '',
    _eventHandler: null,
    _started: false,
    _stopped: false,
    _status: 'uninitialized' as ChannelStatus,
    async init() { this._status = 'disconnected'; },
    async start() { this._started = true; this._status = 'connected'; },
    async stop() { this._stopped = true; this._status = 'disconnected'; },
    async send(content: string): Promise<SendResult> {
      this._lastSendContent = content;
      return { success: true, channelId: id, messageId: `${id}-msg-1` };
    },
    setEventHandler(handler: EventHandler) { this._eventHandler = handler; },
    getStatus() { return this._status; },
  };
}

function makeConfig(enabled: string[]): ChannelsConfig {
  return {
    feishu: { enabled: enabled.includes('feishu'), pushMode: 'lark_channel', receiveMode: 'reaction', chatId: '' },
    qqbot: { enabled: enabled.includes('qqbot'), pushMode: 'c2c_group', receiveMode: 'ws_gateway' },
    'agent-qq-mail': { enabled: enabled.includes('agent-qq-mail'), pushMode: 'smtp', receiveMode: 'imap' },
    telegram: { enabled: enabled.includes('telegram'), pushMode: 'bot_api' },
  };
}

describe('ChannelManager', () => {
  let registry: ChannelRegistry;
  let feishu: ReturnType<typeof makeMockChannel>;
  let qqbot: ReturnType<typeof makeMockChannel>;

  beforeEach(() => {
    registry = new ChannelRegistry();
    feishu = makeMockChannel('feishu');
    qqbot = makeMockChannel('qqbot');
    registry.register(feishu);
    registry.register(qqbot);
  });

  test('init starts all enabled channels', async () => {
    const config = makeConfig(['feishu', 'qqbot']);
    const manager = new ChannelManager(registry, config);
    await manager.init();
    expect(feishu._started).toBe(true);
    expect(qqbot._started).toBe(true);
  });

  test('init does not start disabled channels', async () => {
    const config = makeConfig(['feishu']);
    const manager = new ChannelManager(registry, config);
    await manager.init();
    expect(feishu._started).toBe(true);
    expect(qqbot._started).toBe(false);
  });

  test('broadcast sends to all enabled channels', async () => {
    const config = makeConfig(['feishu', 'qqbot']);
    const manager = new ChannelManager(registry, config);
    await manager.init();
    const results = await manager.broadcast('hello');
    expect(results).toHaveLength(2);
    expect(feishu._lastSendContent).toBe('hello');
    expect(qqbot._lastSendContent).toBe('hello');
  });

  test('broadcast returns per-channel results with errors', async () => {
    const failing: ReturnType<typeof makeMockChannel> = makeMockChannel('telegram');
    failing.send = async () => ({ success: false, channelId: 'telegram', error: 'failed' });
    registry.register(failing);
    const config = makeConfig(['telegram']);
    const manager = new ChannelManager(registry, config);
    await manager.init();
    const results = await manager.broadcast('test');
    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(false);
  });

  test('sendTo sends to a specific channel', async () => {
    const config = makeConfig(['feishu']);
    const manager = new ChannelManager(registry, config);
    await manager.init();
    const result = await manager.sendTo('feishu', 'direct');
    expect(result.success).toBe(true);
    expect(feishu._lastSendContent).toBe('direct');
  });

  test('sendTo throws for unknown channel', async () => {
    const config = makeConfig([]);
    const manager = new ChannelManager(registry, config);
    await expect(manager.sendTo('telegram' as never, 'x')).rejects.toThrow();
  });

  test('shutdown stops all started channels', async () => {
    const config = makeConfig(['feishu']);
    const manager = new ChannelManager(registry, config);
    await manager.init();
    await manager.shutdown();
    expect(feishu._stopped).toBe(true);
  });

  test('onEvent registers handler that receives channel events', async () => {
    const config = makeConfig(['feishu']);
    const manager = new ChannelManager(registry, config);
    await manager.init();
    const events: ChannelEvent[] = [];
    manager.onEvent((e) => events.push(e));

    feishu._eventHandler!({
      type: 'message',
      channelId: 'feishu',
      content: 'hi',
      sender: 'user1',
      messageId: 'm1',
      raw: {},
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('message');
  });

  test('offEvent unregisters a handler', async () => {
    const config = makeConfig(['feishu']);
    const manager = new ChannelManager(registry, config);
    await manager.init();
    const events: ChannelEvent[] = [];
    const handler = (e: ChannelEvent) => events.push(e);
    manager.onEvent(handler);
    manager.offEvent(handler);

    feishu._eventHandler!({
      type: 'message',
      channelId: 'feishu',
      content: 'hi',
      sender: 'u1',
      messageId: 'm1',
      raw: {},
    });

    expect(events).toHaveLength(0);
  });

  test('getStatuses returns status map', async () => {
    const config = makeConfig(['feishu']);
    const manager = new ChannelManager(registry, config);
    await manager.init();
    const statuses = manager.getStatuses();
    expect(statuses.get('feishu')).toBe('connected');
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm --filter @cyber-stray/agent test -- src/channels/manager.test.ts
```

Expected: FAIL — cannot find module `./manager.js`.

---

### Task 1.5: Implement channels/manager.ts

**Files:**
- Create: `packages/agent/src/channels/manager.ts`

- [ ] **Step 1: Write the implementation**

```typescript
import { consola } from '../logger.js';
import type {
  ChannelId,
  ChannelProtocol,
  ChannelEvent,
  SendResult,
  ChannelStatus,
  ChannelsConfig,
} from './types.js';
import type { ChannelRegistry } from './registry.js';

const logger = consola.withTag('ChannelManager');

type EventHandler = (event: ChannelEvent) => void;

/**
 * Central lifecycle manager for all message channels.
 *
 * Created once at startup from ChannelRegistry + ChannelsConfig.
 * Manages init/start/broadcast/shutdown across all enabled channels,
 * and routes inbound events to registered handlers.
 */
export class ChannelManager {
  private registry: ChannelRegistry;
  private config: ChannelsConfig;
  private handlers: EventHandler[] = [];
  private startedChannels: ChannelProtocol[] = [];

  constructor(registry: ChannelRegistry, config: ChannelsConfig) {
    this.registry = registry;
    this.config = config;
  }

  /**
   * Initialize and start all enabled channels.
   *
   * For each enabled channel:
   * 1. Call channel.init(config) with channel-specific config from ChannelsConfig
   * 2. Call channel.setEventHandler() to bridge events back to our handlers
   * 3. Call channel.start() to connect
   *
   * Channels that fail to init/start log a warning but don't block startup.
   */
  async init(): Promise<void> {
    const enabled = this.registry.listEnabled(this.config);

    for (const channel of enabled) {
      const chConfig = this.config[channel.id];
      try {
        await channel.init(chConfig as unknown as Record<string, unknown>);
        channel.setEventHandler((event: ChannelEvent) => this.emitEvent(event));
        await channel.start();
        this.startedChannels.push(channel);
        logger.success(`channel [${channel.id}] started`);
      } catch (error) {
        logger.warn(`channel [${channel.id}] init/start failed (not blocking)`, {
          error: String(error),
        });
      }
    }
  }

  /**
   * Send content to all enabled channels.
   * Returns per-channel results; broadcast succeeds even if some channels fail.
   */
  async broadcast(content: string): Promise<SendResult[]> {
    const results: SendResult[] = [];
    for (const channel of this.startedChannels) {
      try {
        const result = await channel.send(content);
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          channelId: channel.id,
          error: String(error),
        });
      }
    }
    return results;
  }

  /**
   * Send to a single channel by id.
   */
  async sendTo(channelId: ChannelId, content: string): Promise<SendResult> {
    const channel = this.registry.get(channelId);
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }
    return channel.send(content);
  }

  /**
   * Register a handler for inbound events from all channels.
   */
  onEvent(handler: EventHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Remove a previously registered event handler.
   */
  offEvent(handler: EventHandler): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  /**
   * Stop all started channels and release resources.
   */
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

  /**
   * Get current status of all registered channels.
   */
  getStatuses(): Map<ChannelId, ChannelStatus> {
    const map = new Map<ChannelId, ChannelStatus>();
    for (const channel of this.registry.list()) {
      map.set(channel.id, channel.getStatus());
    }
    return map;
  }

  /**
   * Internal: push an event to all registered handlers.
   */
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
```

- [ ] **Step 2: Run tests — expect pass**

```bash
pnpm --filter @cyber-stray/agent test -- src/channels/manager.test.ts
```

Expected: All 11 tests PASS.

---

### Task 1.6: Create channels/index.ts + singleton export

**Files:**
- Create: `packages/agent/src/channels/index.ts`

- [ ] **Step 1: Write the barrel + singleton factory**

```typescript
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

// ── Singleton access ──

import { ChannelRegistry } from './registry.js';
import { ChannelManager } from './manager.js';
import type { ChannelsConfig } from './types.js';

let instance: ChannelManager | null = null;

/**
 * Get the singleton ChannelManager. Must call initChannelManager() first.
 */
export function getChannelManager(): ChannelManager {
  if (!instance) {
    throw new Error('ChannelManager not initialized — call initChannelManager(config) first');
  }
  return instance;
}

/**
 * Create and initialize the singleton ChannelManager.
 * Called once at application startup.
 *
 * Channels register themselves by importing and calling registry.register().
 * This function wires everything together.
 */
export async function initChannelManager(config: ChannelsConfig): Promise<void> {
  const registry = new ChannelRegistry();
  // Channels self-register at import time in their respective module files.
  // initChannelManager is called AFTER all channel imports have executed.
  instance = new ChannelManager(registry, config);
  await instance.init();
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter @cyber-stray/agent typecheck
```

Expected: No type errors.

---

### Task 1.7: Run all Phase 1 tests

- [ ] **Step 1: Run the full test suite**

```bash
pnpm --filter @cyber-stray/agent test -- src/channels/
```

Expected: All registry + manager tests pass.

---

## Phase 2: Feishu Channel Migration (Progressive)

### Task 2.1: Add ChannelsConfig to types.ts and config.ts

**Files:**
- Modify: `packages/agent/src/types.ts` (add `channels` field)
- Modify: `packages/agent/src/config.ts` (read channels config with fallback)

- [ ] **Step 1: Add channels field to AgentConfig**

In `packages/agent/src/types.ts`, add to the `AgentConfig` interface (before the closing `}`):

```typescript
  // ── Channel abstraction (v2) ──
  channels?: {
    feishu?: {
      enabled?: boolean;
      pushMode?: 'lark_channel' | 'webhook';
      receiveMode?: 'reaction' | 'none';
      chatId?: string;
    };
    qqbot?: {
      enabled?: boolean;
      pushMode?: 'c2c' | 'c2c_group';
      receiveMode?: 'ws_gateway' | 'none';
    };
    'agent-qq-mail'?: {
      enabled?: boolean;
      pushMode?: string;
      receiveMode?: string;
    };
    telegram?: {
      enabled?: boolean;
      pushMode?: 'bot_api';
    };
  };
```

- [ ] **Step 2: Add ChannelsConfig defaults and merge in config.ts**

In `packages/agent/src/config.ts`, add to the `BehaviorConfig` type and `defaultBehavior`:

In `BehaviorConfig` pick list, add:
```typescript
  | 'channels'
```

In `defaultBehavior` object, add:
```typescript
  channels: {
    // Default: use existing feishu config fields. Actual enabled/disabled
    // is derived at runtime from whether the old env vars are set.
    // These defaults act as a safety net with field-level merging.
  } as BehaviorConfig['channels'],
```

In `loadBehaviorConfig()`, add field-level merge for channels:
```typescript
        channels: {
          ...defaultBehavior.channels,
          ...(file.channels ?? {}),
        },
```

Then in the exported `config` object, add channels reading with fallback:

```typescript
  // ── Channel abstraction config (v2, falls back to old fields) ──
  channels: {
    feishu: {
      enabled: behavior.channels?.feishu?.enabled ?? !!(config.larkAppId || config.feishuWebhook),
      pushMode: behavior.channels?.feishu?.pushMode ?? (config.larkAppId ? 'lark_channel' : 'webhook'),
      receiveMode: behavior.channels?.feishu?.receiveMode ?? 'reaction',
      chatId: behavior.channels?.feishu?.chatId ?? config.feishu?.chatId ?? '',
    },
    qqbot: {
      enabled: behavior.channels?.qqbot?.enabled ?? false,
      pushMode: behavior.channels?.qqbot?.pushMode ?? 'c2c_group',
      receiveMode: behavior.channels?.qqbot?.receiveMode ?? 'ws_gateway',
    },
    'agent-qq-mail': {
      enabled: behavior.channels?.['agent-qq-mail']?.enabled ?? false,
      pushMode: behavior.channels?.['agent-qq-mail']?.pushMode ?? 'smtp',
      receiveMode: behavior.channels?.['agent-qq-mail']?.receiveMode ?? 'imap',
    },
    telegram: {
      enabled: behavior.channels?.telegram?.enabled ?? !!(config.telegramBotToken),
      pushMode: 'bot_api' as const,
    },
  },
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @cyber-stray/agent typecheck
```

Expected: No errors. Also run existing config tests:

```bash
pnpm --filter @cyber-stray/agent test -- src/config.test.ts
```

---

### Task 2.2: Create FeishuChannel (wraps existing modules)

**Files:**
- Create: `packages/agent/src/channels/feishu/channel.ts`

- [ ] **Step 1: Write the FeishuChannel**

```typescript
import type { ChannelProtocol, ChannelEvent, SendResult, ChannelStatus, FeishuChannelConfig } from '../types.js';
import { consola } from '../../logger.js';
import { sendFeishuMessage } from '../../tools/push/lark-sender.js';
import { initFeishuWS, closeFeishuWS } from '../../tools/feishu/ws-client.js';
import { processFeedback } from '../../memory/feedback-pipeline.js';

const logger = consola.withTag('FeishuChannel');

export class FeishuChannel implements ChannelProtocol {
  readonly id = 'feishu' as const;
  readonly name = 'Feishu';

  private config: FeishuChannelConfig | null = null;
  private status: ChannelStatus = 'uninitialized';
  private lastError: string | null = null;
  private eventHandler: ((event: ChannelEvent) => void) | null = null;

  async init(config: Record<string, unknown>): Promise<void> {
    this.config = config as unknown as FeishuChannelConfig;
    this.status = 'disconnected';
  }

  async start(): Promise<void> {
    if (!this.config) throw new Error('FeishuChannel not initialized');

    this.status = 'connecting';
    try {
      // The existing ws-client.ts registers its own reaction handler
      // that calls processFeedback directly. We need to intercept that
      // by temporarily wrapping the module — or wiring after init.
      //
      // For Phase 2 (progressive migration), we let the existing
      // ws-client.ts handle reactions internally via processFeedback().
      // In Phase 6 (cleanup), we inline the receiver and route through
      // this.eventHandler instead.
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

  getStatus(): ChannelStatus {
    return this.status;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  private emitStatus(status: ChannelStatus, detail?: string): void {
    if (this.eventHandler) {
      this.eventHandler({
        type: 'status_change',
        channelId: 'feishu',
        status,
        detail,
      });
    }
  }
}

/** Singleton instance for registry registration */
export const feishuChannel = new FeishuChannel();
```

- [ ] **Step 2: Register FeishuChannel in channels/index.ts**

Modify `packages/agent/src/channels/index.ts` to import and register FeishuChannel after creating the registry:

In `initChannelManager()`, after `const registry = new ChannelRegistry();`, add:
```typescript
  // Register channel implementations (import order doesn't matter)
  import('./feishu/channel.js').then((mod) => {
    registry.register(mod.feishuChannel);
  });
```

Wait — this async import pattern is problematic. Better approach: register channels in a synchronous block before calling `instance.init()`. Let me adjust:

```typescript
import { feishuChannel } from './feishu/channel.js';

export async function initChannelManager(config: ChannelsConfig): Promise<void> {
  const registry = new ChannelRegistry();
  // Register channels
  registry.register(feishuChannel);
  // (future channels registered here)

  instance = new ChannelManager(registry, config);
  await instance.init();
}
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @cyber-stray/agent typecheck
```

---

### Task 2.3: Rewire speak.ts to use ChannelManager.broadcast()

**Files:**
- Modify: `packages/agent/src/tools/push/speak.ts`

- [ ] **Step 1: Replace hardcoded channel dispatch with ChannelManager.broadcast()**

Current code (lines 40-70 roughly) has:
```typescript
  // 推送到飞书
  if (config.feishu?.pushMode === 'lark_channel') { ... }
  else if (config.feishuWebhook) { ... }

  // 尝试推送到 Telegram
  if (config.telegramBotToken && config.telegramChatId) { ... }
```

Replace the entire channel dispatch block with:

```typescript
  let pushed = false;
  let messageId: string | undefined;
  const pushErrors: string[] = [];

  // ── Channel abstraction: broadcast to all enabled channels ──
  try {
    const { getChannelManager } = await import('../../channels/index.js');
    const cm = getChannelManager();
    const results = await cm.broadcast(content);

    for (const result of results) {
      if (result.success) {
        pushed = true;
        if (result.messageId && !messageId) {
          messageId = result.messageId;
        }
        logger.info('channel pushed', { channelId: result.channelId, messageId: result.messageId });
      } else {
        pushErrors.push(`[${result.channelId}] ${result.error}`);
      }
    }
  } catch (error) {
    logger.warn('ChannelManager not available (may not be initialized yet)', { error: String(error) });
    // Fallback: no channels available, still log
  }

  // 没有配置任何推送渠道时，仅记录日志
  if (!pushed && pushErrors.length === 0) {
    logger.info('无推送渠道配置，内容仅记录日志', { content: content.slice(0, 100) });
  }
```

**Also remove the `pushToTelegram` function** (lines 33-38 in the original). It's now handled by TelegramChannel.

**Also remove the `sendFeishuMessage` import** — replace `import { sendFeishuMessage } from './lark-sender.js';` with nothing (it's no longer needed).

- [ ] **Step 2: Run existing speak tests to ensure no regression**

```bash
pnpm --filter @cyber-stray/agent test -- src/tools/
```

Note: Some speak tests may fail if they mock specific Feishu/Telegram behavior. We'll fix those in the next task.

---

### Task 2.4: Update speak tests for channel abstraction

**Files:**
- Locate existing speak tests (if any) and update

- [ ] **Step 1: Check if speak tests exist**

```bash
pnpm --filter @cyber-stray/agent test -- --reporter=verbose 2>&1 | Select-String "speak"
```

If no speak tests exist, skip this task. If they exist, update them to mock `ChannelManager` instead of Feishu/Telegram-specific mocks.

---

### Task 2.5: Rewire index.ts startup and shutdown

**Files:**
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Replace initFeishuWS/closeFeishuWS with ChannelManager**

In `packages/agent/src/index.ts`:

**Remove imports:**
```typescript
// REMOVE:
import { initFeishuWS, closeFeishuWS } from "./tools/feishu/ws-client.js";
```

**Add import:**
```typescript
import { initChannelManager, getChannelManager } from "./channels/index.js";
```

**Replace startup code** (the `initFeishuWS()` call around line 37):
```typescript
  // OLD:
  // 初始化飞书事件订阅（WebSocket 长连接）
  // await initFeishuWS();

  // NEW:
  // 初始化 Channel 抽象层（飞书/QQ Bot/Agent QQ Mail/Telegram）
  try {
    // config.channels already has defaults from config.ts with old-field fallback
    await initChannelManager(config.channels!);
    logger.info('Channel 层初始化完成');

    // Wire feedback pipeline to channel events
    const cm = getChannelManager();
    cm.onEvent((event) => {
      if (event.type === 'reaction') {
        processFeedback(
          event.emoji === 'thumbs_up' ? 'like' : 'dislike',
          event.messageId,
          event.userId,
        ).catch((err) => logger.warn('反馈管道处理失败', { error: String(err) }));
      }
    });
  } catch (error) {
    logger.warn('Channel 层初始化部分失败（不阻断启动）', { error: String(error) });
  }
```

Note: we also need to import `processFeedback`:
```typescript
import { processFeedback } from "./memory/feedback-pipeline.js";
```

**Replace shutdown code** (around line 153):
```typescript
  // OLD:
  // await closeFeishuWS();

  // NEW:
  try {
    await getChannelManager().shutdown();
    logger.info('所有 Channel 已关闭');
  } catch (err) {
    logger.warn('关闭 Channel 失败', { error: String(err) });
  }
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter @cyber-stray/agent typecheck
```

---

### Task 2.6: Mark deprecated files

**Files:**
- Modify: `packages/agent/src/tools/feishu/ws-client.ts`
- Modify: `packages/agent/src/tools/push/lark-sender.ts`
- Modify: `packages/agent/src/tools/push/feishu-card.ts`

- [ ] **Step 1: Add @deprecated comments**

Add at the top of each file (after existing header comment):

```typescript
/** @deprecated Moved to packages/agent/src/channels/feishu/. Will be inlined and deleted in Phase 6 migration. */
```

---

### Task 2.7: Run full test suite for Phase 2 regression

- [ ] **Step 1: Run all tests**

```bash
pnpm --filter @cyber-stray/agent test
```

Expected: All previously passing tests still pass. Channel-related tests should not regress.

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @cyber-stray/agent typecheck
```

---

## Phase 3: QQ Bot Channel (C2C + Group @Message + Markdown)

### Task 3.1: Create qqbot/token-manager.ts + test

**Files:**
- Create: `packages/agent/src/channels/qqbot/token-manager.ts`
- Create: `packages/agent/src/channels/qqbot/token-manager.test.ts`

- [ ] **Step 1: Write token-manager.test.ts (TDD)**

```typescript
import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { TokenManager } from './token-manager.js';

describe('TokenManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('getToken fetches on first call', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok_abc123', expires_in: 7200 }),
    } as Response);
    globalThis.fetch = fetchSpy;

    const tm = new TokenManager('app1', 'secret1');
    const token = await tm.getToken();
    expect(token).toBe('tok_abc123');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test('getToken returns cached token when valid', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok_abc123', expires_in: 7200 }),
    } as Response);
    globalThis.fetch = fetchSpy;

    const tm = new TokenManager('app1', 'secret1');
    await tm.getToken();
    const token2 = await tm.getToken();
    expect(token2).toBe('tok_abc123');
    expect(fetchSpy).toHaveBeenCalledTimes(1); // cached
  });

  test('getToken refreshes when near expiry', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok_first', expires_in: 7200 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok_second', expires_in: 7200 }),
      } as Response);
    globalThis.fetch = fetchSpy;

    const tm = new TokenManager('app1', 'secret1');
    await tm.getToken();

    // Advance time past expiry window (7100 + 200 = 7300, well past 7100)
    vi.advanceTimersByTime(7300 * 1000);

    const token2 = await tm.getToken();
    expect(token2).toBe('tok_second');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test('getToken throws on fetch failure', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: 40001, message: 'invalid' }),
    } as Response);
    globalThis.fetch = fetchSpy;

    const tm = new TokenManager('app1', 'secret1');
    await expect(tm.getToken()).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test — expect failure**
- [ ] **Step 3: Implement token-manager.ts**

```typescript
interface TokenData {
  accessToken: string;
  expiresIn: number;       // seconds
  obtainedAt: number;      // Date.now()
}

export class TokenManager {
  private token: TokenData | null = null;

  constructor(
    private appId: string,
    private clientSecret: string,
  ) {}

  private get isValid(): boolean {
    if (!this.token) return false;
    const elapsed = (Date.now() - this.token.obtainedAt) / 1000;
    return elapsed < this.token.expiresIn - 100; // 100s buffer
  }

  async getToken(): Promise<string> {
    if (this.isValid && this.token) {
      return this.token.accessToken;
    }
    return this.fetchToken();
  }

  authHeader(): Record<string, string> {
    // Header format: Authorization: QQBot {access_token}
    // Token is fetched lazily by api.ts before each request, so
    // the header is built per-request.
    return {}; // placeholder — actual header built in api.ts
  }

  private async fetchToken(): Promise<string> {
    const resp = await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: this.appId, clientSecret: this.clientSecret }),
    });

    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(`QQBot token fetch failed: HTTP ${resp.status} ${(data as { message?: string }).message ?? ''}`);
    }

    const data = (await resp.json()) as { access_token: string; expires_in: number };
    this.token = {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
      obtainedAt: Date.now(),
    };
    return this.token.accessToken;
  }
}
```

- [ ] **Step 4: Run test — expect pass**

---

### Task 3.2: Create qqbot/api.ts + test

**Files:**
- Create: `packages/agent/src/channels/qqbot/api.ts`
- Create: `packages/agent/src/channels/qqbot/api.test.ts`

- [ ] **Step 1: Write api.test.ts (TDD)**

```typescript
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { MessageApi, type SendMessageResult } from './api.js';

describe('MessageApi', () => {
  let api: MessageApi;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg_new_1', timestamp: '2026-01-01T00:00:00+08:00' }),
    } as Response);
    globalThis.fetch = fetchSpy;
    api = new MessageApi('test-token');
  });

  test('sendC2CText posts correct body', async () => {
    const result = await api.sendC2CText('user_openid_123', 'hello');
    expect(result.id).toBe('msg_new_1');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v2/users/user_openid_123/messages');
    const body = JSON.parse(init.body as string);
    expect(body.msg_type).toBe(0);
    expect(body.content).toBe('hello');
  });

  test('sendC2CMarkdown posts msg_type 2', async () => {
    await api.sendC2CMarkdown('u1', '# hello');
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.msg_type).toBe(2);
    expect(body.markdown.content).toBe('# hello');
  });

  test('sendGroupText posts correct group endpoint', async () => {
    await api.sendGroupText('group_openid_g1', 'hi group');
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v2/groups/group_openid_g1/messages');
  });

  test('sendGroupMarkdown posts markdown to group', async () => {
    await api.sendGroupMarkdown('g1', '**bold**');
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.msg_type).toBe(2);
  });

  test('includes QQBot auth header', async () => {
    await api.sendC2CText('u1', 'test');
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('QQBot test-token');
  });

  test('throws on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ code: 22009, message: 'msg limit exceed' }),
    } as Response);
    await expect(api.sendC2CText('u1', 'test')).rejects.toThrow('22009');
  });
});
```

- [ ] **Step 2: Run test — expect failure**
- [ ] **Step 3: Implement api.ts**

```typescript
import { consola } from '../../logger.js';

const logger = consola.withTag('QQBot:api');
const BASE_URL = 'https://api.sgroup.qq.com';

export interface SendMessageResult {
  id: string;
  timestamp: string;
}

export class MessageApi {
  constructor(private accessToken: string) {}

  async sendC2CText(openid: string, content: string): Promise<SendMessageResult> {
    return this.post(`/v2/users/${openid}/messages`, {
      content,
      msg_type: 0,
    });
  }

  async sendC2CMarkdown(openid: string, content: string): Promise<SendMessageResult> {
    return this.post(`/v2/users/${openid}/messages`, {
      msg_type: 2,
      markdown: { content },
    });
  }

  async sendGroupText(groupOpenid: string, content: string): Promise<SendMessageResult> {
    return this.post(`/v2/groups/${groupOpenid}/messages`, {
      content,
      msg_type: 0,
    });
  }

  async sendGroupMarkdown(groupOpenid: string, content: string): Promise<SendMessageResult> {
    return this.post(`/v2/groups/${groupOpenid}/messages`, {
      msg_type: 2,
      markdown: { content },
    });
  }

  private async post(path: string, body: Record<string, unknown>): Promise<SendMessageResult> {
    const url = `${BASE_URL}${path}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `QQBot ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    const data = (await resp.json()) as { id?: string; timestamp?: string; code?: number; message?: string };

    if (!resp.ok || data.code) {
      throw new Error(`QQBot API error: code=${data.code ?? resp.status} ${data.message ?? ''}`);
    }

    return { id: data.id ?? '', timestamp: data.timestamp ?? '' };
  }
}
```

- [ ] **Step 4: Run test — expect pass**

---

### Task 3.3: Install WebSocket dependency + create qqbot/gateway.ts

**Files:**
- Create: `packages/agent/src/channels/qqbot/gateway.ts`

- [ ] **Step 0: Install isomorphic-ws for Node.js WebSocket support**

```bash
pnpm --filter @cyber-stray/agent add isomorphic-ws
pnpm --filter @cyber-stray/agent add -D @types/isomorphic-ws
```

- [ ] **Step 1: Implement gateway.ts**

Since WebSocket integration tests are complex, we write the implementation first and add a mock-based unit test for the state machine logic.

```typescript
import { consola } from '../../logger.js';
import type { ChannelEvent } from '../types.js';

const logger = consola.withTag('QQBot:gateway');

const GATEWAY_INTENTS = 1107296260; // C2C + Group + Guild @ + Channel DM + Interaction

export interface GatewayPayload {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
}

export type RawEventHandler = (event: GatewayPayload) => void;

export interface GatewayState {
  sessionId: string | null;
  lastSeq: number | null;
  connected: boolean;
}

/**
 * Manages a QQ Bot WebSocket gateway connection.
 *
 * Lifecycle:
 *   connect() → GET /gateway → WSS connect → Op10 Hello →
 *   Op2 Identify → Op0 READY → heartbeat loop + event dispatch
 *
 * On disconnect, reconnect with exponential backoff.
 */
export class GatewayConnection {
  private ws: WebSocket | null = null;
  private heartbeatInterval: number = 45000; // ms
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private onEvent: RawEventHandler | null = null;
  private onStateChange: ((state: GatewayState) => void) | null = null;

  state: GatewayState = {
    sessionId: null,
    lastSeq: null,
    connected: false,
  };

  constructor(
    private accessToken: string,
  ) {}

  setEventHandlers(
    onEvent: RawEventHandler,
    onStateChange?: (state: GatewayState) => void,
  ): void {
    this.onEvent = onEvent;
    this.onStateChange = onStateChange;
  }

  async connect(): Promise<void> {
    // 1. Get gateway URL
    const token = this.accessToken;
    const resp = await fetch('https://api.sgroup.qq.com/gateway', {
      headers: { 'Authorization': `QQBot ${token}` },
    });

    if (!resp.ok) {
      throw new Error(`Failed to get gateway URL: HTTP ${resp.status}`);
    }

    const { url } = (await resp.json()) as { url: string };

    // 2. Connect WebSocket
    await this.connectWebSocket(url);
  }

  private connectWebSocket(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.running = true;

      this.ws.onopen = () => {
        logger.info('WebSocket connected, waiting for Hello...');
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data as string) as GatewayPayload;
          this.handlePayload(payload, resolve, reject);
        } catch (err) {
          logger.error('Failed to parse gateway payload', { error: String(err) });
        }
      };

      this.ws.onclose = (event: CloseEvent) => {
        logger.warn('WebSocket closed', { code: event.code, reason: event.reason });
        this.state.connected = false;
        this.stopHeartbeat();
        this.emitStateChange();
      };

      this.ws.onerror = () => {
        if (!this.state.connected) {
          reject(new Error('WebSocket connection error'));
        }
      };
    });
  }

  private handlePayload(
    payload: GatewayPayload,
    resolve: (value: void) => void,
    reject: (reason: Error) => void,
  ): void {
    this.state.lastSeq = payload.s ?? this.state.lastSeq;

    switch (payload.op) {
      case 10: // Hello
        this.heartbeatInterval = (payload.d as { heartbeat_interval: number }).heartbeat_interval;
        this.sendIdentify();
        this.startHeartbeat();
        break;

      case 0: // Dispatch
        if (payload.t === 'READY') {
          const d = payload.d as { session_id: string };
          this.state.sessionId = d.session_id;
          this.state.connected = true;
          this.emitStateChange();
          resolve();
          logger.success('Gateway READY, session established');
        } else if (payload.t === 'RESUMED') {
          this.state.connected = true;
          logger.success('Gateway RESUMED');
        } else if (this.onEvent) {
          this.onEvent(payload);
        }
        break;

      case 7: // Reconnect
        logger.warn('Server requested reconnect (Op7)');
        this.disconnect();
        break;

      case 9: // Invalid Session
        this.state.sessionId = null;
        reject(new Error('Invalid session (Op9)'));
        break;

      case 11: // Heartbeat ACK
        break;

      default:
        logger.debug('Unknown opcode', { op: payload.op });
    }
  }

  private sendIdentify(): void {
    const payload: GatewayPayload = {
      op: 2,
      d: {
        token: `QQBot ${this.accessToken}`,
        intents: GATEWAY_INTENTS,
        shard: [0, 1],
        properties: {
          $os: 'linux',
          $browser: 'cyber-stray',
          $device: 'cyber-stray',
        },
      },
    };
    this.ws?.send(JSON.stringify(payload));
  }

  sendResume(): void {
    const payload: GatewayPayload = {
      op: 6,
      d: {
        token: `QQBot ${this.accessToken}`,
        session_id: this.state.sessionId,
        seq: this.state.lastSeq,
      },
    };
    this.ws?.send(JSON.stringify(payload));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const interval = this.heartbeatInterval * 0.8; // 20% buffer
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.running) {
        this.ws.send(JSON.stringify({ op: 1, d: this.state.lastSeq }));
      }
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  disconnect(): void {
    this.running = false;
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.state.connected = false;
    this.emitStateChange();
  }

  private emitStateChange(): void {
    this.onStateChange?.(this.state);
  }
}
```

**Note on WebSocket dependency:** This code uses the browser `WebSocket` global. For Node.js, we need to polyfill with `isomorphic-ws`. Add to `packages/agent/package.json`:

```bash
pnpm --filter @cyber-stray/agent add isomorphic-ws
pnpm --filter @cyber-stray/agent add -D @types/isomorphic-ws
```

Then add at top of gateway.ts:
```typescript
import WebSocket from 'isomorphic-ws';
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter @cyber-stray/agent typecheck
```

---

### Task 3.4: Create qqbot/dispatcher.ts + test

**Files:**
- Create: `packages/agent/src/channels/qqbot/dispatcher.ts`
- Create: `packages/agent/src/channels/qqbot/dispatcher.test.ts`

- [ ] **Step 1: Write dispatcher.test.ts**

```typescript
import { describe, test, expect, vi } from 'vitest';
import type { ChannelEvent } from '../types.js';
import { EventDispatcher } from './dispatcher.js';
import type { GatewayPayload } from './gateway.js';

describe('EventDispatcher', () => {
  test('dispatches C2C_MESSAGE_CREATE as ChannelEvent message', () => {
    const handler = vi.fn<(event: ChannelEvent) => void>();
    const dispatcher = new EventDispatcher(handler);

    const payload: GatewayPayload = {
      op: 0,
      s: 5,
      t: 'C2C_MESSAGE_CREATE',
      d: {
        author: { id: 'user_openid_1' },
        content: 'hello bot',
        id: 'msg_id_abc',
      },
    };

    dispatcher.dispatch(payload);

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0]!;
    expect(event.type).toBe('message');
    expect(event.channelId).toBe('qqbot');
    expect(event.content).toBe('hello bot');
    expect(event.sender).toBe('user_openid_1');
    expect(event.messageId).toBe('msg_id_abc');
  });

  test('dispatches GROUP_AT_MESSAGE_CREATE with group info', () => {
    const handler = vi.fn<(event: ChannelEvent) => void>();
    const dispatcher = new EventDispatcher(handler);

    dispatcher.dispatch({
      op: 0,
      s: 8,
      t: 'GROUP_AT_MESSAGE_CREATE',
      d: {
        group_openid: 'group_g1',
        author: { id: 'member1', member_openid: 'mem_1' },
        content: '@bot help',
        id: 'group_msg_1',
      },
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0]!;
    expect(event.type).toBe('message');
    expect((event as { groupId?: string }).raw).toBeDefined();
  });

  test('dispatches FRIEND_ADD as relationship event', () => {
    const handler = vi.fn<(event: ChannelEvent) => void>();
    const dispatcher = new EventDispatcher(handler);

    dispatcher.dispatch({
      op: 0,
      s: 2,
      t: 'FRIEND_ADD',
      d: { openid: 'new_friend' },
    });

    const event = handler.mock.calls[0]![0]!;
    expect(event.type).toBe('relationship');
    if (event.type === 'relationship') {
      expect(event.action).toBe('friend_add');
      expect(event.userId).toBe('new_friend');
    }
  });

  test('ignores unknown event types', () => {
    const handler = vi.fn();
    const dispatcher = new EventDispatcher(handler);
    dispatcher.dispatch({ op: 0, t: 'UNKNOWN_EVENT', d: {} });
    expect(handler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — expect failure**
- [ ] **Step 3: Implement dispatcher.ts**

```typescript
import type { ChannelEvent } from '../types.js';
import type { GatewayPayload } from './gateway.js';

export class EventDispatcher {
  constructor(private handler: (event: ChannelEvent) => void) {}

  dispatch(payload: GatewayPayload): void {
    switch (payload.t) {
      case 'C2C_MESSAGE_CREATE': {
        const d = payload.d as { author: { id: string }; content: string; id: string };
        this.handler({
          type: 'message',
          channelId: 'qqbot',
          content: d.content,
          sender: d.author.id,
          messageId: d.id,
          raw: d,
        });
        break;
      }

      case 'GROUP_AT_MESSAGE_CREATE': {
        const d = payload.d as {
          group_openid: string;
          author: { id: string; member_openid?: string };
          content: string;
          id: string;
        };
        this.handler({
          type: 'message',
          channelId: 'qqbot',
          content: d.content,
          sender: d.author.member_openid ?? d.author.id,
          messageId: d.id,
          raw: d,
        });
        break;
      }

      case 'FRIEND_ADD':
        this.handler({
          type: 'relationship',
          channelId: 'qqbot',
          action: 'friend_add',
          userId: (payload.d as { openid: string }).openid,
          raw: payload.d,
        });
        break;

      case 'FRIEND_DEL':
        this.handler({
          type: 'relationship',
          channelId: 'qqbot',
          action: 'friend_delete',
          userId: (payload.d as { openid: string }).openid,
          raw: payload.d,
        });
        break;

      case 'GROUP_ADD_ROBOT':
        this.handler({
          type: 'relationship',
          channelId: 'qqbot',
          action: 'group_join',
          groupId: (payload.d as { group_openid: string }).group_openid,
          raw: payload.d,
        });
        break;

      case 'GROUP_DEL_ROBOT':
        this.handler({
          type: 'relationship',
          channelId: 'qqbot',
          action: 'group_leave',
          groupId: (payload.d as { group_openid: string }).group_openid,
          raw: payload.d,
        });
        break;

      // INTERACTION_CREATE, C2C_MSG_REJECT/RECEIVE, GROUP_MSG_REJECT/RECEIVE
      // deferred — non-goal for Phase 3.
      default:
        break;
    }
  }
}
```

- [ ] **Step 4: Run test — expect pass**

---

### Task 3.5: Create qqbot/reconnect.ts + test

**Files:**
- Create: `packages/agent/src/channels/qqbot/reconnect.ts`
- Create: `packages/agent/src/channels/qqbot/reconnect.test.ts`

- [ ] **Step 1: Write reconnect.test.ts**

```typescript
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReconnectManager } from './reconnect.js';

describe('ReconnectManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('retries with exponential backoff on failure', async () => {
    const connectFn = vi.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValueOnce(undefined);

    const rm = new ReconnectManager(connectFn);
    const promise = rm.retryConnect();

    // First attempt immediate, fails
    await vi.advanceTimersByTimeAsync(0);
    // Second attempt after 1s backoff
    await vi.advanceTimersByTimeAsync(1000);
    // Third attempt after 2s backoff
    await vi.advanceTimersByTimeAsync(2000);

    await promise;
    expect(connectFn).toHaveBeenCalledTimes(3);
  });

  test('resets attempt count on successful connect', () => {
    const rm = new ReconnectManager(async () => {});
    // Simulate failed attempts
    (rm as { attemptCount: number }).attemptCount = 5;
    rm.reset();
    expect((rm as { attemptCount: number }).attemptCount).toBe(0);
  });

  test('fatal code 4914 stops retries', async () => {
    const connectFn = vi.fn().mockRejectedValue(Object.assign(new Error('banned'), { code: 4914 }));
    const rm = new ReconnectManager(connectFn);
    await expect(rm.retryConnect()).rejects.toThrow(/Fatal/);
    expect(connectFn).toHaveBeenCalledTimes(1); // no retry
  });

  test('fatal code 4915 stops retries', async () => {
    const connectFn = vi.fn().mockRejectedValue(Object.assign(new Error('deleted'), { code: 4915 }));
    const rm = new ReconnectManager(connectFn);
    await expect(rm.retryConnect()).rejects.toThrow(/Fatal/);
    expect(connectFn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test — expect failure**
- [ ] **Step 3: Implement reconnect.ts**

```typescript
import { consola } from '../../logger.js';

const logger = consola.withTag('QQBot:reconnect');

const BACKOFF = [1, 2, 5, 10, 30, 60]; // seconds
const MAX_ATTEMPTS = 100;

const FATAL_CODES = new Set([4914, 4915]); // bot banned/deleted

export class ReconnectManager {
  private attemptCount = 0;

  constructor(private connectFn: () => Promise<void>) {}

  reset(): void {
    this.attemptCount = 0;
  }

  async retryConnect(): Promise<void> {
    for (this.attemptCount = 0; this.attemptCount < MAX_ATTEMPTS; this.attemptCount++) {
      const delay = BACKOFF[Math.min(this.attemptCount, BACKOFF.length - 1)]!;
      if (this.attemptCount > 0) {
        logger.info(`Reconnect attempt ${this.attemptCount} after ${delay}s`);
        await sleep(delay * 1000);
      }

      try {
        await this.connectFn();
        this.reset();
        return;
      } catch (err) {
        const code = (err as { code?: number }).code;
        if (code && FATAL_CODES.has(code)) {
          logger.error(`Fatal error, stopping reconnect`, { code });
          throw new Error(`Fatal: QQ Bot ${code} — bot disabled or deleted`);
        }
        logger.warn(`Reconnect attempt ${this.attemptCount} failed: ${String(err)}`);
      }
    }

    throw new Error(`Max reconnect attempts (${MAX_ATTEMPTS}) reached`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 4: Run test — expect pass**

---

### Task 3.6: Create qqbot/channel.ts (assembles all modules)

**Files:**
- Create: `packages/agent/src/channels/qqbot/channel.ts`

- [ ] **Step 1: Implement QQBotChannel**

```typescript
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
  private lastError: string | null = null;
  private eventHandler: ((event: ChannelEvent) => void) | null = null;

  private tokenManager: TokenManager | null = null;
  private gateway: GatewayConnection | null = null;
  private reconnect: ReconnectManager | null = null;
  private api: MessageApi | null = null;

  async init(config: Record<string, unknown>): Promise<void> {
    this.config = config as unknown as QQBotChannelConfig;

    const appId = process.env.QQBOT_APP_ID;
    const appSecret = process.env.QQBOT_APP_SECRET;
    if (!appId || !appSecret) {
      throw new Error('QQBot channel requires QQBOT_APP_ID and QQBOT_APP_SECRET env vars');
    }

    this.tokenManager = new TokenManager(appId, appSecret);
    this.status = 'disconnected';
  }

  async start(): Promise<void> {
    if (!this.tokenManager) throw new Error('QQBotChannel not initialized');

    this.status = 'connecting';
    this.emitStatus('connecting');

    try {
      const token = await this.tokenManager.getToken();
      this.api = new MessageApi(token);

      this.gateway = new GatewayConnection(token);
      const dispatcher = new EventDispatcher((event) => {
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

      const connectGw = async () => {
        const freshToken = await this.tokenManager!.getToken();
        this.api = new MessageApi(freshToken);
        this.gateway = new GatewayConnection(freshToken);
        const disp = new EventDispatcher((event) => {
          this.eventHandler?.(event);
        });
        this.gateway.setEventHandlers(
          (payload) => disp.dispatch(payload),
          (state) => {
            if (!state.connected) {
              this.status = 'disconnected';
              this.emitStatus('disconnected');
            }
          },
        );
        await this.gateway!.connect();
      };

      await connectGw();

      this.reconnect = new ReconnectManager(async () => {
        await connectGw();
      });

      this.status = 'connected';
      this.emitStatus('connected');
      logger.success('QQBot channel connected');
    } catch (error) {
      this.status = 'error';
      this.lastError = String(error);
      logger.error('QQBot channel start failed', { error: String(error) });
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.gateway?.disconnect();
    this.status = 'disconnected';
  }

  async send(content: string): Promise<SendResult> {
    if (!this.api) {
      return { success: false, channelId: 'qqbot', error: 'Channel not connected' };
    }

    try {
      // For active push (agent-initiated), we don't have a specific openid or group_openid.
      // QQ Bot requires a target. For MVP, send to C2C — eventually ChannelManager
      // will pass a target via SendOptions.
      const result = await this.api.sendC2CText('default', content);
      return { success: true, channelId: 'qqbot', messageId: result.id };
    } catch (error) {
      return { success: false, channelId: 'qqbot', error: String(error) };
    }
  }

  setEventHandler(handler: (event: ChannelEvent) => void): void {
    this.eventHandler = handler;
  }

  getStatus(): ChannelStatus {
    return this.status;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  private emitStatus(status: ChannelStatus, detail?: string): void {
    if (this.eventHandler) {
      this.eventHandler({
        type: 'status_change',
        channelId: 'qqbot',
        status,
        detail,
      });
    }
  }
}

export const qqbotChannel = new QQBotChannel();
```

- [ ] **Step 2: Register QQBotChannel in channels/index.ts**

Add to `initChannelManager()`:
```typescript
import { qqbotChannel } from './qqbot/channel.js';

// In initChannelManager(), after `const registry = new ChannelRegistry();`:
registry.register(qqbotChannel);
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @cyber-stray/agent typecheck
```

---

### Task 3.7: Run all Phase 3 tests

- [ ] **Step 1: Run tests**

```bash
pnpm --filter @cyber-stray/agent test -- src/channels/qqbot/
```

Expected: All token-manager, api, dispatcher, reconnect tests pass.

---

## Phase 4: Agent QQ Mail Channel

### Task 4.1: Create agent-qq-mail/cli.ts + test

**Files:**
- Create: `packages/agent/src/channels/agent-qq-mail/cli.ts`
- Create: `packages/agent/src/channels/agent-qq-mail/cli.test.ts`

- [ ] **Step 1: Write cli.test.ts**

```typescript
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { AgentlyCLI } from './cli.js';
import { execSync } from 'child_process';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

describe('AgentlyCLI', () => {
  let cli: AgentlyCLI;

  beforeEach(() => {
    vi.clearAllMocks();
    cli = new AgentlyCLI();
  });

  test('send invokes agently-cli with content', () => {
    vi.mocked(execSync).mockReturnValue('ok');
    cli.send('test content');
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('agently-cli'),
      expect.any(Object),
    );
  });

  test('getEmail returns email from +me', () => {
    vi.mocked(execSync).mockReturnValue('agent@qq.com');
    const email = cli.getEmail();
    expect(email).toBe('agent@qq.com');
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('+me'),
      expect.any(Object),
    );
  });

  test('readRecent returns parsed emails', () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify([
      { from: 'alice@qq.com', subject: 'hello', body: 'hi there', date: '2026-01-01' },
    ]));
    const emails = cli.readRecent(5);
    expect(emails).toHaveLength(1);
    expect(emails[0]!.from).toBe('alice@qq.com');
  });

  test('readRecent handles CLI errors gracefully', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('CLI not found');
    });
    const emails = cli.readRecent(5);
    expect(emails).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test — expect failure**
- [ ] **Step 3: Implement cli.ts**

```typescript
import { execSync } from 'child_process';
import { consola } from '../../logger.js';

const logger = consola.withTag('AgentlyCLI');

export interface EmailMessage {
  from: string;
  subject: string;
  body: string;
  date: string;
}

export class AgentlyCLI {
  send(content: string): void {
    try {
      execSync(`agently-cli send --body "${content.replace(/"/g, '\\"')}"`, {
        timeout: 30_000,
        encoding: 'utf-8',
      });
      logger.info('email sent via agently-cli');
    } catch (error) {
      logger.error('agently-cli send failed', { error: String(error) });
      throw error;
    }
  }

  getEmail(): string {
    try {
      const output = execSync('agently-cli +me', {
        timeout: 10_000,
        encoding: 'utf-8',
      });
      return output.trim();
    } catch (error) {
      logger.error('agently-cli +me failed', { error: String(error) });
      throw error;
    }
  }

  readRecent(count: number = 5): EmailMessage[] {
    try {
      const output = execSync(`agently-cli read --count ${count} --format json`, {
        timeout: 30_000,
        encoding: 'utf-8',
      });
      return JSON.parse(output) as EmailMessage[];
    } catch (error) {
      logger.warn('agently-cli read failed', { error: String(error) });
      return [];
    }
  }
}
```

- [ ] **Step 4: Run test — expect pass**

---

### Task 4.2: Create agent-qq-mail/channel.ts

**Files:**
- Create: `packages/agent/src/channels/agent-qq-mail/channel.ts`

- [ ] **Step 1: Implement AgentQQMailChannel**

```typescript
import type { ChannelProtocol, ChannelEvent, SendResult, ChannelStatus, AgentQQMailChannelConfig } from '../types.js';
import { consola } from '../../logger.js';
import { AgentlyCLI } from './cli.js';

const logger = consola.withTag('AgentQQMail');

export class AgentQQMailChannel implements ChannelProtocol {
  readonly id = 'agent-qq-mail' as const;
  readonly name = 'Agent QQ Mail';

  private status: ChannelStatus = 'uninitialized';
  private lastError: string | null = null;
  private eventHandler: ((event: ChannelEvent) => void) | null = null;
  private cli: AgentlyCLI = new AgentlyCLI();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private emailAddress: string = '';

  async init(config: Record<string, unknown>): Promise<void> {
    const c = config as unknown as AgentQQMailChannelConfig;
    if (!c.enabled) {
      this.status = 'disconnected';
      return;
    }
    this.status = 'disconnected';
  }

  async start(): Promise<void> {
    this.status = 'connecting';
    this.emitStatus('connecting');

    try {
      this.emailAddress = process.env.AGENTQQMAIL_EMAIL ?? this.cli.getEmail();
      this.status = 'connected';
      this.emitStatus('connected');
      logger.success('Agent QQ Mail connected', { email: this.emailAddress });

      // Start polling for incoming emails
      if (this.eventHandler) {
        this.pollInterval = setInterval(() => this.pollInbox(), 60_000); // every 60s
      }
    } catch (error) {
      this.status = 'error';
      this.lastError = String(error);
      this.emitStatus('error', String(error));
      logger.error('Agent QQ Mail start failed', { error: String(error) });
    }
  }

  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.status = 'disconnected';
  }

  async send(content: string): Promise<SendResult> {
    try {
      this.cli.send(content);
      return { success: true, channelId: 'agent-qq-mail', messageId: `mail-${Date.now()}` };
    } catch (error) {
      return { success: false, channelId: 'agent-qq-mail', error: String(error) };
    }
  }

  setEventHandler(handler: (event: ChannelEvent) => void): void {
    this.eventHandler = handler;
  }

  getStatus(): ChannelStatus {
    return this.status;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  private pollInbox(): void {
    const emails = this.cli.readRecent(5);
    for (const email of emails) {
      if (this.eventHandler) {
        this.eventHandler({
          type: 'message',
          channelId: 'agent-qq-mail',
          content: email.body,
          sender: email.from,
          messageId: `email-${email.date}`,
          raw: email,
        });
      }
    }
  }

  private emitStatus(status: ChannelStatus, detail?: string): void {
    if (this.eventHandler) {
      this.eventHandler({ type: 'status_change', channelId: 'agent-qq-mail', status, detail });
    }
  }
}

export const agentQQMailChannel = new AgentQQMailChannel();
```

- [ ] **Step 2: Register in channels/index.ts**

Add import and `registry.register(agentQQMailChannel)`.

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @cyber-stray/agent typecheck
```

---

## Phase 5: Telegram Channel Migration

### Task 5.1: Create telegram/channel.ts

**Files:**
- Create: `packages/agent/src/channels/telegram/channel.ts`

- [ ] **Step 1: Extract Telegram logic from speak.ts into channel**

```typescript
import type { ChannelProtocol, ChannelEvent, SendResult, ChannelStatus, TelegramChannelConfig } from '../types.js';
import { consola } from '../../logger.js';

const logger = consola.withTag('Telegram');

export class TelegramChannel implements ChannelProtocol {
  readonly id = 'telegram' as const;
  readonly name = 'Telegram';

  private status: ChannelStatus = 'uninitialized';
  private lastError: string | null = null;
  private eventHandler: ((event: ChannelEvent) => void) | null = null;

  async init(_config: Record<string, unknown>): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      throw new Error('Telegram channel requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID env vars');
    }
    this.status = 'connected'; // Telegram is stateless — no persistent connection
  }

  async start(): Promise<void> {
    // Telegram Bot API is REST-based, no persistent connection needed.
    this.status = 'connected';
  }

  async stop(): Promise<void> {
    this.status = 'disconnected';
  }

  async send(content: string): Promise<SendResult> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      return { success: false, channelId: 'telegram', error: 'Not configured' };
    }

    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const body = JSON.stringify({ chat_id: chatId, text: content, parse_mode: 'HTML' });
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`Telegram push failed: HTTP ${response.status}`);
      }

      const data = (await response.json()) as { ok?: boolean; description?: string; result?: { message_id?: number } };
      if (!data.ok) {
        throw new Error(`Telegram push failed: ${data.description ?? 'unknown'}`);
      }

      logger.success('Telegram message sent');
      return {
        success: true,
        channelId: 'telegram',
        messageId: String(data.result?.message_id ?? ''),
      };
    } catch (error) {
      return { success: false, channelId: 'telegram', error: String(error) };
    }
  }

  setEventHandler(handler: (event: ChannelEvent) => void): void {
    this.eventHandler = handler;
  }

  getStatus(): ChannelStatus {
    return this.status;
  }

  getLastError(): string | null {
    return this.lastError;
  }
}

export const telegramChannel = new TelegramChannel();
```

- [ ] **Step 2: Register in channels/index.ts + remove Telegram from speak.ts**

In `channels/index.ts`, import and register:
```typescript
import { telegramChannel } from './telegram/channel.js';
// ...
registry.register(telegramChannel);
```

In `tools/push/speak.ts`, remove the `pushToTelegram` function (if still present).

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @cyber-stray/agent typecheck
```

---

## Phase 6: Cleanup

### Task 6.1: Inline Feishu logic, delete deprecated files

**Files to delete:**
- `packages/agent/src/tools/feishu/ws-client.ts`
- `packages/agent/src/tools/push/lark-sender.ts`
- `packages/agent/src/tools/push/feishu-card.ts`

**Files to update:**
- `packages/agent/src/channels/feishu/channel.ts` — inline the sender/receiver logic

- [ ] **Step 1: Move lark-sender.ts logic into FeishuChannel**

Copy `sendFeishuMessage()` and helper functions from `lark-sender.ts` directly into `channels/feishu/channel.ts` as private methods.

- [ ] **Step 2: Move ws-client.ts logic into FeishuChannel**

Copy `initFeishuWS()` / `closeFeishuWS()` logic into `channels/feishu/channel.ts`, but replace the direct `processFeedback()` call with `this.eventHandler(ChannelEvent { type: 'reaction', ... })`.

- [ ] **Step 3: Move feishu-card.ts into FeishuChannel**

Copy `buildFeedbackCard()` and `buildSimpleText()` as private methods.

- [ ] **Step 4: Delete deprecated files**

```bash
Remove-Item -LiteralPath "packages/agent/src/tools/feishu/ws-client.ts"
Remove-Item -LiteralPath "packages/agent/src/tools/push/lark-sender.ts"
Remove-Item -LiteralPath "packages/agent/src/tools/push/feishu-card.ts"
```

- [ ] **Step 5: Remove old config fields from AgentConfig type**

Remove from `packages/agent/src/types.ts`:
- `feishuWebhook?: string;`
- `telegramBotToken?: string;`
- `telegramChatId?: string;`
- `larkAppId?: string;`
- `larkAppSecret?: string;`
- `feishu?: { pushMode; receiveMode; chatId? }`

These are now accessed only via `config.channels.*`.

- [ ] **Step 6: Remove fallback config reading in config.ts**

Remove old-field environment reads (`FEISHU_WEBHOOK`, `TELEGRAM_BOT_TOKEN`, etc.) from the exported `config` object. Only keep `channels.*`.

- [ ] **Step 7: Verify full test suite**

```bash
pnpm --filter @cyber-stray/agent test
pnpm --filter @cyber-stray/agent typecheck
pnpm lint
```

Expected: All tests pass, no type errors, no lint errors.

---

### Task 6.2: Update .env.example and data/agent-config.json

**Files:**
- Modify: `.env.example`
- Modify: `data/agent-config.json` (if it exists; else create a default)

- [ ] **Step 1: Update .env.example**

Add new env vars:
```bash
# QQ Bot
QQBOT_APP_ID=your_qq_app_id
QQBOT_APP_SECRET=your_qq_app_secret

# Agent QQ Mail
AGENTQQMAIL_EMAIL=agent@qq.com
```

- [ ] **Step 2: Add channels section to agent-config.json**

Add to `data/agent-config.json`:
```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "pushMode": "lark_channel",
      "receiveMode": "reaction",
      "chatId": "oc_xxx"
    },
    "qqbot": {
      "enabled": false,
      "pushMode": "c2c_group",
      "receiveMode": "ws_gateway"
    },
    "agent-qq-mail": {
      "enabled": false,
      "pushMode": "smtp",
      "receiveMode": "imap"
    },
    "telegram": {
      "enabled": false,
      "pushMode": "bot_api"
    }
  }
}
```

---

### Task 6.3: Final verification

- [ ] **Step 1: Run full test suite**

```bash
pnpm --filter @cyber-stray/agent test
```

Expected: All tests pass (existing + new channel tests).

- [ ] **Step 2: Run typecheck + lint**

```bash
pnpm typecheck
pnpm lint
```

Expected: No errors.

- [ ] **Step 3: Verify no stale imports**

```bash
rg "tools/feishu/ws-client" --include="*.ts" packages/agent/src/
rg "tools/push/lark-sender" --include="*.ts" packages/agent/src/
rg "tools/push/feishu-card" --include="*.ts" packages/agent/src/
```

Expected: No matches (all migrated to channels/feishu/).
