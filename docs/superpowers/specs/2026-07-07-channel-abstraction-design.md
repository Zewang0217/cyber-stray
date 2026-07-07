# Channel Abstraction Layer — Design Spec

## Overview

Abstract all agent message channels (Feishu, QQ Bot, Agent QQ Mail, Telegram) behind a unified `ChannelProtocol` interface. Replace hardcoded channel logic in `speak.ts` and `index.ts` with a `ChannelManager` that broadcasts send operations and dispatches incoming events as normalized `ChannelEvent` streams.

## Goals

- **Unified interface**: One `ChannelProtocol` for all channels — send required, receive optional
- **Unified event stream**: All inbound messages/reactions from any channel become `ChannelEvent`, consumed by the same pipeline
- **Decoupled config**: New top-level `channels.*` in `agent-config.json`; old `feishu*`/`telegram*` fields deprecated (fallback still works)
- **Progressive migration**: Feishu internals reused during Phase 2, rewritten inline in Phase 6
- **Testable**: Each channel is independently mockable; ChannelManager is replaceable in tests

## Non-Goals

- Real-time streaming to QQ C2C (QQ Bot `stream_messages`) — deferred to Phase 2
- QQ Bot channels (guild), rich media upload, scan-to-configure onboarding — deferred
- Channel-specific message formatting (cards, buttons, embeds) — all channels send plain text for now

---

## Architecture

```
packages/agent/src/channels/
├── types.ts                  # ChannelProtocol, ChannelEvent, ChannelConfig, ChannelStatus, etc.
├── registry.ts                # ChannelRegistry: register/get/list enabled channels
├── manager.ts                 # ChannelManager: init → start → broadcast → getEvents → stop
│
├── feishu/
│   ├── channel.ts             # FeishuChannel implements ChannelProtocol
│   ├── sender.ts              # (migrated from tools/push/lark-sender.ts in Phase 6)
│   ├── receiver.ts             # (migrated from tools/feishu/ws-client.ts in Phase 6)
│   └── card.ts                # (migrated from tools/push/feishu-card.ts in Phase 6)
│
├── qqbot/
│   ├── channel.ts             # QQBotChannel implements ChannelProtocol
│   ├── token-manager.ts       # OAuth2 access_token cache + proactive refresh
│   ├── gateway.ts             # WebSocket: connect → Op10 Hello → Op2 Identify → Op0 READY
│   ├── api.ts                 # REST: C2C text/markdown + group text/markdown
│   ├── dispatcher.ts          # Op0 DISPATCH → C2C_MESSAGE_CREATE/GROUP_AT_MESSAGE_CREATE → ChannelEvent
│   └── reconnect.ts           # Exponential backoff reconnect + session resume
│
├── agent-qq-mail/
│   ├── channel.ts             # AgentQQMailChannel implements ChannelProtocol
│   └── cli.ts                 # agently-cli wrapper (send/read/status)
│
└── telegram/
    └── channel.ts             # TelegramChannel implements ChannelProtocol
```

---

## Core Types

### ChannelProtocol

```typescript
type ChannelId = 'feishu' | 'qqbot' | 'agent-qq-mail' | 'telegram';

type ChannelStatus = 'uninitialized' | 'disconnected' | 'connecting' | 'connected' | 'error';

interface SendOptions {
  /** Optional reply target (e.g. QQ msg_id for passive reply) */
  replyTo?: string;
}

interface SendResult {
  success: boolean;
  channelId: ChannelId;
  messageId?: string;
  error?: string;
}

interface ChannelProtocol {
  readonly id: ChannelId;
  readonly name: string;

  // Lifecycle
  init(config: Record<string, unknown>): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;

  // Send (required — all channels must push)
  send(content: string, options?: SendOptions): Promise<SendResult>;

  // Event emission — ChannelManager injects a handler after init
  // Channel calls this._emitEvent(event) when it receives an inbound message/reaction/status change
  setEventHandler(handler: (event: ChannelEvent) => void): void;

  // Status
  getStatus(): ChannelStatus;
  getLastError?(): string | null;
}
```

### ChannelEvent

```typescript
type ChannelEvent =
  | {
      type: 'message';
      channelId: ChannelId;
      content: string;
      sender: string;          // user openid / email / username
      messageId: string;       // channel-specific message ID
      replyTo?: string;        // for passive reply routing
      raw: unknown;            // original channel-specific payload
    }
  | {
      type: 'reaction';
      channelId: ChannelId;
      emoji: string;           // 'thumbs_up' | 'thumbs_down' | etc.
      action: 'added' | 'removed';
      messageId: string;
      userId: string;
      raw: unknown;
    }
  | {
      type: 'status_change';
      channelId: ChannelId;
      status: ChannelStatus;
      detail?: string;
    }
  | {
      type: 'relationship';
      channelId: ChannelId;
      action: 'friend_add' | 'friend_delete' | 'group_join' | 'group_leave';
      userId?: string;
      groupId?: string;
      raw: unknown;
    };
```

### ChannelConfig (in AgentConfig)

```typescript
interface ChannelsConfig {
  feishu: {
    enabled: boolean;
    pushMode: 'lark_channel' | 'webhook';
    receiveMode: 'reaction' | 'none';
    chatId: string;
  };
  qqbot: {
    enabled: boolean;
    /** 'c2c_group' = both C2C and group @message */
    pushMode: 'c2c' | 'c2c_group';
    receiveMode: 'ws_gateway' | 'none';
  };
  'agent-qq-mail': {
    enabled: boolean;
    pushMode: string;
    receiveMode: string;
  };
  telegram: {
    enabled: boolean;
    pushMode: 'bot_api';
  };
}
```

### ChannelRegistry

```typescript
class ChannelRegistry {
  register(channel: ChannelProtocol): void;
  get(id: ChannelId): ChannelProtocol | undefined;
  list(): ChannelProtocol[];
  listEnabled(): ChannelProtocol[];  // filtered by config.channels.*.enabled
}
```

### ChannelManager

```typescript
class ChannelManager {
  constructor(registry: ChannelRegistry, config: ChannelsConfig);

  /** Init + start all enabled channels. Called once at startup. */
  async init(): Promise<void>;

  /** Send content to all enabled channels. Returns per-channel results. */
  async broadcast(content: string): Promise<SendResult[]>;

  /** Send to a specific channel. */
  async sendTo(channelId: ChannelId, content: string): Promise<SendResult>;

  /** Register a handler for all channel events. */
  onEvent(handler: (event: ChannelEvent) => void): void;
  offEvent(handler: (event: ChannelEvent) => void): void;

  /** Stop all channels and release resources. */
  async shutdown(): Promise<void>;

  /** Get aggregated status. */
  getStatuses(): Map<ChannelId, ChannelStatus>;
}
```

---

## Data Flow

### Send (agent → channels)

```
LLM → speak tool (registry/speak.ts — unchanged)
        │
        └→ tools/push/speak.ts::speak(content, type)
              │                                   ↑
              │  Phase 2: replaces hardcoded       │
              │  feishu/telegram logic with        │
              │  ChannelManager.broadcast()        │
              │                                    │
              ├→ ChannelManager.broadcast(content)  │
              │     │                              │
              │     ├─ FeishuChannel.send(content)   → lark-sender.ts (existing)
              │     ├─ QQBotChannel.send(content)    → api.ts (new REST)
              │     ├─ AgentQQMailChannel.send(...)  → cli.ts (agently-cli)
              │     └─ TelegramChannel.send(content) → bot API
              │
              ├→ appendSpeakHistory(content, type, pushed, timestamp, messageId)
              │     ↑
              │     messageId comes from broadcast result (first channel that returned one)
              │
              └→ registerSpeakTopics(messageId, topics)
                    ↑
                    messageTopicMap still in-memory, keyed by channel messageId (string).
                    Compatible across all channels — each channel's SendResult.messageId is a string.
```


### Receive (channels → agent)

ChannelManager calls `channel.setEventHandler(callback)` during `init()`. Each channel stores the callback and fires it when native events arrive.

```
Feishu WebSocket reaction event
  → ws-client.ts → FeishuChannel._eventHandler(ChannelEvent { type: 'reaction', ... })
                    → ChannelManager._emitEvent()

QQ Bot WebSocket DISPATCH event
  → gateway.ts → dispatcher.ts → QQBotChannel._eventHandler(ChannelEvent { type: 'message', ... })
                                  → ChannelManager._emitEvent()

// ChannelManager._emitEvent() calls all registered onEvent handlers
ChannelManager.onEvent(handler)
  → FeedbackPipeline.processChannelEvent(event)  (new — wraps existing processFeedback)
        │
        ├─ reaction event → recordFeedback() + updateUserProfile + InterestGraph.reinforce
        ├─ message event  → forward to agent loop (future: interactive mode)
        └─ status_change  → log + update TUI
```

### Startup & Shutdown

```
index.ts:main()
  ┌─ validateConfig()
  ├─ ChannelManager.init()          ← replaces initFeishuWS()
  │    ├─ read config.channels.*
  │    ├─ for each enabled channel:
  │    │    channel.init(config)     (no-connect setup)
  │    │    channel.start()          (connect + begin rx/tx)
  │    └─ register onEvent handler → feedback pipeline
  ├─ loadState()
  ├─ startHeartbeat()
  └─ (on SIGINT) ChannelManager.shutdown()
```

---

## Migration Phases

### Phase 1 — Skeleton (no user-facing change)

**Files to create:**
- `packages/agent/src/channels/types.ts`
- `packages/agent/src/channels/registry.ts`
- `packages/agent/src/channels/manager.ts`

**Verification:** Types compile, registry tests pass, manager unit tests pass. No existing code modified.

### Phase 2 — Feishu Migration (consumer-transparent)

**Files to create/modify:**
- Create `packages/agent/src/channels/feishu/channel.ts` — implements `ChannelProtocol`, internally delegates to existing `tools/push/lark-sender.ts` + `tools/feishu/ws-client.ts`
- Modify `tools/push/speak.ts` — `speak()` calls `channelManager.broadcast()` instead of hardcoded Feishu/Telegram
- Modify `packages/agent/src/index.ts` — `channelManager.init()` replaces `initFeishuWS()` / `closeFeishuWS()`
- Mark `tools/feishu/ws-client.ts`, `tools/push/lark-sender.ts`, `tools/push/feishu-card.ts` as `@deprecated`
- Add `channels` config section to `AgentConfig` type + `config.ts` with fallback reading

**Verification:** All existing tests pass. Agent starts, sends, receives feedback normally.

### Phase 3 — QQ Bot C2C + Group @Message + Markdown

**Files to create:**
- `packages/agent/src/channels/qqbot/token-manager.ts`
- `packages/agent/src/channels/qqbot/api.ts`
- `packages/agent/src/channels/qqbot/gateway.ts`
- `packages/agent/src/channels/qqbot/dispatcher.ts`
- `packages/agent/src/channels/qqbot/reconnect.ts`
- `packages/agent/src/channels/qqbot/channel.ts`

**New env vars:** `QQBOT_APP_ID`, `QQBOT_APP_SECRET`

**Key behaviors:**
- `TokenManager`: Cache token for 7100s, refresh when <100s remain
- `GatewayConnection`: Connect → Op10 Hello → heartbeat loop (interval × 0.8) → Op2 Identify (intents: 1107296260)
- `MessageApi.send_c2c_text/openid, content, reply_msg_id` → POST `/v2/users/{openid}/messages` with `msg_type: 0`
- `MessageApi.send_c2c_markdown/openid, content, reply_msg_id` → POST `/v2/users/{openid}/messages` with `msg_type: 2`
- `MessageApi.send_group_text/group_openid, content, reply_msg_id` → POST `/v2/groups/{group_openid}/messages`
- `MessageApi.send_group_markdown/group_openid, content, reply_msg_id` → POST `/v2/groups/{group_openid}/messages`
- `EventDispatcher`: Route `t` field → C2C_MESSAGE_CREATE / GROUP_AT_MESSAGE_CREATE → emit `ChannelEvent { type: 'message' }`
- `ReconnectManager`: Backoff `[1,2,5,10,30,60]` seconds, max 100 attempts, session resume via Op6 when possible
- QQ Bot sends are **active push** (not passive reply) since the agent initiates communication — no `msg_id` in outgoing messages

**Verification:** Unit tests for token manager, API, gateway, dispatcher, reconnect. Channel integration test with mock QQ server.

### Phase 4 — Agent QQ Mail

**Files to create:**
- `packages/agent/src/channels/agent-qq-mail/cli.ts`
- `packages/agent/src/channels/agent-qq-mail/channel.ts`

**New env vars:** `AGENTQQMAIL_EMAIL`

**Key behaviors:**
- `cli.ts` wraps `agently-cli` commands: `send`, `read`, `status`
- `send(content)` → `agently-cli send --to <email> --body <content>` (or equivalent)
- `receive` → periodic poll via `agently-cli read` → parse email bodies → emit `ChannelEvent { type: 'message' }`
- OAuth already handled via `agently-cli auth login` (done once, token cached by CLI)

**Verification:** Mock CLI output, test channel send/poll cycle.

### Phase 5 — Telegram Migration

**Files to create:**
- `packages/agent/src/channels/telegram/channel.ts`

Migrate existing `pushToTelegram()` logic from `tools/push/speak.ts` into `TelegramChannel.send()`.

**Verification:** Existing Telegram push tests pass against new channel.

### Phase 6 — Cleanup

**Actions:**
- Delete `tools/feishu/ws-client.ts`, `tools/push/lark-sender.ts`, `tools/push/feishu-card.ts`
- Inline any remaining logic into `channels/feishu/`
- Remove old top-level `feishu*` / `telegram*` fields from `AgentConfig` type
- Remove fallback config reading in `config.ts`
- Remove deprecated comments

**Verification:** Full test suite passes. No references to deleted files.

---

## Configuration Mapping

### agent-config.json (new sections)

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

### .env (new vars)

```bash
# QQ Bot
QQBOT_APP_ID=your_qq_app_id
QQBOT_APP_SECRET=your_qq_app_secret

# Agent QQ Mail
AGENTQQMAIL_EMAIL=agent@qq.com
```

---

## Testing Strategy

- **Channel interface contract**: Each `ChannelProtocol` implementation gets a unit test that verifies `id`, `init`/`start`/`stop` lifecycle, `send` returns `SendResult`, `getStatus` returns valid state
- **ChannelManager**: Unit tests with mock channels. Verify `broadcast()` calls all enabled channels, `shutdown()` calls `stop()` on all, events propagate to registered handlers
- **ChannelRegistry**: Simple — register, get by id, list, listEnabled filtered by config
- **QQ Bot token-manager**: Mock `fetch`, verify cache hit/miss/refresh timing
- **QQ Bot gateway**: Integration test with embedded WebSocket server (using `ws` library or similar), verify Op10→Op2→Op0 handshake, heartbeat, Op0 event dispatch, reconnect flow
- **Feishu channel**: Maintain existing test coverage; verify channel wrapper delegates correctly
- **Agent QQ Mail**: Mock `execSync` for CLI calls, verify argument construction

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| QQ Bot WebSocket connection unstable | Exponential backoff reconnect + session resume (Op6), same pattern as Feishu |
| QQ Bot rate limits (30 qpm unverified, 60 qpm verified) | Send queue with throttling in `MessageApi` — burst of messages gets rate-limited not dropped |
| `agently-cli` dependency not available in CI | Agent QQ Mail channel is `enabled: false` by default; tests mock CLI entirely |
| Feedback pipeline currently hardwired to `messageTopicMap` keyed by Feishu messageId | `registerSpeakTopics()` already uses string messageId — QQ Bot returns `id` from REST, compatible as-is |
