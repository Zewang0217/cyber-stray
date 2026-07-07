# Channel Abstraction Layer — Architecture Report

## 设计目标

将 Agent 的消息收发通道（飞书、QQ Bot、Agent QQ Mail、Telegram）统一抽象为 `ChannelProtocol` 接口，消除 `speak.ts` 和 `index.ts` 中硬编码的多渠道分支，替换为一行 `channelManager.broadcast(content)`。

核心原则：
- **统一接口** —— 一种 `ChannelProtocol`，所有 channel 实现
- **统一事件流** —— 所有入站消息/反馈归一为 `ChannelEvent`，由同一条管道消费
- **解耦配置** —— `agent-config.json` 新增 `channels.*`，旧 `feishu*`/`telegram*` 字段逐步废弃
- **渐进迁移** —— 飞书内部复用已有模块，不断改写，最后阶段内联清理
- **可测试** —— 每个 channel 独立可 mock，ChannelManager 可替换

## 架构分层

```
packages/agent/src/channels/
├── types.ts                  # 核心类型
├── registry.ts               # ChannelRegistry：注册/发现
├── manager.ts                # ChannelManager：生命周期 + 事件路由
├── index.ts                  # barrel export + 单例工厂
│
├── feishu/channel.ts         # FeishuChannel（已内联 sender/receiver/card）
├── qqbot/                    # QQ Bot API v2
│   ├── channel.ts            #   QQBotChannel：组装 + 目标追踪
│   ├── token-manager.ts      #   OAuth2 token 缓存 + 提前刷新
│   ├── api.ts                #   REST：C2C text/markdown + group text/markdown
│   ├── gateway.ts            #   WebSocket：Op10→Op2→Op0 + heartbeat
│   ├── dispatcher.ts         #   Op0 DISPATCH → ChannelEvent
│   └── reconnect.ts          #   指数退避重连 + session resume
├── agent-qq-mail/
│   ├── cli.ts                #   agently-cli 命令包装
│   └── channel.ts            #   AgentQQMailChannel：邮件收发 + 定常轮询
└── telegram/
    └── channel.ts            #   TelegramChannel：Bot API 推送
```

### 三层结构

| 层 | 职责 | 文件 |
|----|------|------|
| **接口层** | `ChannelProtocol`、`ChannelEvent`、`ChannelsConfig` | `types.ts` |
| **注册层** | `ChannelRegistry`：register / get / list / listEnabled | `registry.ts` |
| **管理层** | `ChannelManager`：init → broadcast → shutdown → onEvent | `manager.ts` + `index.ts`（单例） |

## 核心接口

### ChannelProtocol

每个 channel 实现的最小契约：

```
id: ChannelId        —— 唯一标识（'feishu' | 'qqbot' | 'agent-qq-mail' | 'telegram'）
name: string         —— 可读名称
init(config)         —— 读取配置，不连接
start()              —— 建立连接，开始收发
stop()               —— 断开连接，释放资源
send(content, opts?) —— 发送消息（必选，所有 channel 必须支持推送）
setEventHandler(fn)  —— 接收事件回调（由 ChannelManager 注入）
getStatus()          —— 连接状态（uninitialized → disconnected → connecting → connected → error）
getLastError?()      —— 最后错误信息
```

### ChannelEvent

所有入站消息/反馈/状态变化归一为 4 种事件类型：

```
message         —— 用户发来的文本消息（C2C 私聊、群聊 @、邮件）
reaction        —— 用户的表情反馈（👍/👎）
status_change   —— channel 连接状态变化
relationship    —— 关系事件（好友添加/删除、群加入/移出）
```

### ChannelsConfig

`agent-config.json` 中 `channels` 段的类型定义，每个 channel 独立控制开关和行为：

```jsonc
{
  "channels": {
    "feishu":       { "enabled": true,  "pushMode": "lark_channel|webhook", "receiveMode": "reaction|none", "chatId": "oc_xxx" },
    "qqbot":        { "enabled": false, "pushMode": "c2c|c2c_group",         "receiveMode": "ws_gateway|none" },
    "agent-qq-mail": { "enabled": false, "pushMode": "smtp",                  "receiveMode": "imap" },
    "telegram":     { "enabled": false, "pushMode": "bot_api" }
  }
}
```

环境变量：
```bash
# Feishu       —— LARK_APP_ID, LARK_APP_SECRET, FEISHU_WEBHOOK （已有）
# QQ Bot       —— QQBOT_APP_ID, QQBOT_APP_SECRET               （新增）
# Agent QQ Mail —— AGENTQQMAIL_EMAIL                           （新增）
# Telegram     —— TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID          （已有）
```

## 数据流

### 发送（Agent → Channel）

```
LLM → speak tool (registry/speak.ts)
        └─ tools/push/speak.ts::speak(content, type)
              ├─ ChannelManager.broadcast(content)
              │    ├─ FeishuChannel.send()     → LarkChannel 或 Webhook
              │    ├─ QQBotChannel.send()      → 遍历 knownOpenids / knownGroupIds 发 REST
              │    ├─ AgentQQMailChannel.send() → agently-cli
              │    └─ TelegramChannel.send()    → Bot API
              ├─ appendSpeakHistory()          （不变）
              └─ registerSpeakTopics()         （不变）
```

### 接收（Channel → Agent）

```
ChannelManager.onEvent(handler)
  └─ feedback-pipeline 消费 ChannelEvent
       ├─ reaction event    → recordFeedback + updateUserProfile + InterestGraph.reinforce
       ├─ message event     → 未来 interactive mode 时转发给 agent loop
       └─ status_change     → 日志 + TUI
```

每个 channel 内部将原生事件转为 `ChannelEvent` 后调用 `setEventHandler` 注入的回调，ChannelManager 再广播给所有注册的 handler。

### 启动/关闭

```
index.ts:main()
  ├─ validateConfig()
  ├─ initChannelManager(config.channels)    ← 替换 initFeishuWS()
  │    ├─ registry.register(feishu, qqbot, agentQQMail, telegram)
  │    ├─ 遍历 enabled channels: init() → setEventHandler() → start()
  │    └─ 失败仅 warn，不阻断启动
  ├─ cm.onEvent(handler)                   ← 桥接 feedback-pipeline
  ├─ loadState()
  ├─ startHeartbeat()
  └─ (SIGINT) channelManager.shutdown()
```

## Channel 实现摘要

### FeishuChannel

- **发送**：LarkChannel（优先）→ Webhook（回退），支持 markdown + 互动卡片
- **接收**：WebSocket 长连接，订阅 `reaction` 事件（👍/👎）→ 转为 `ChannelEvent(type: 'reaction')`
- **配置**：`LARK_APP_ID` / `LARK_APP_SECRET` / `FEISHU_WEBHOOK`，chatId
- **迁移**：内部实现已从 `tools/feishu/ws-client.ts` + `tools/push/lark-sender.ts` 内联，不再依赖全局 `config` 单例

### QQBotChannel

QQ Bot API v2，基于 OAuth2 + WebSocket Gateway + REST API。

- **Token 管理**：`TokenManager` 缓存 7100s，剩余 < 100s 时提前刷新，所有 REST 请求带 `QQBot {token}` header
- **WebSocket Gateway**：`GatewayConnection` — GET `/gateway` → WSS connect → Op10 Hello → Op2 Identify（intents: 1107296260）→ Op0 READY → heartbeat（interval × 0.8）
- **事件分发**：`EventDispatcher` — C2C_MESSAGE_CREATE / GROUP_AT_MESSAGE_CREATE → `ChannelEvent(type: 'message')`，FRIEND_ADD/DEL → `relationship`，GROUP_ADD_ROBOT/DEL_ROBOT → `relationship`
- **发送**：从事件中追踪 `knownOpenids` / `knownGroupIds`，`send()` 向所有已知目标广播 C2C text + group text。FRIEND_DEL / GROUP_DEL_ROBOT 时自动移除目标
- **重连**：`ReconnectManager` — 退避 [1,2,5,10,30,60]s，最多 100 次，致命码 4914/4915 停止
- **配置**：`QQBOT_APP_ID` / `QQBOT_APP_SECRET`

### AgentQQMailChannel

基于 QQ 邮箱 Agent 邮箱服务，通过 `agently-cli` 命令行工具操作。

- **发送**：`agently-cli send --body "<content>"`
- **接收**：定时轮询（60s）`agently-cli read --count 5 --format json` → 邮件 body → `ChannelEvent(type: 'message')`
- **OAuth**：由 `agently-cli auth login` 单独完成，token 由 CLI 缓存
- **配置**：`AGENTQQMAIL_EMAIL`

### TelegramChannel

基于 Telegram Bot API 的 REST 推送。

- **发送**：`POST /bot{token}/sendMessage`（HTML parse_mode）
- **接收**：当前未实现（Telegram 通常作为纯推送渠道）
- **配置**：`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`

## 测试覆盖

```
channels/registry.test.ts        7 tests  — register/get/list/listEnabled/overwrite
channels/manager.test.ts        15 tests  — init/broadcast/sendTo/shutdown/onEvent/offEvent/statuses + error paths
channels/qqbot/token-manager.test.ts  6 tests  — fetch/cache/expiry/error/authHeader
channels/qqbot/api.test.ts      10 tests  — C2C/group text/markdown body + auth header + errors
channels/qqbot/dispatcher.test.ts  8 tests  — C2C/group/relationship events → ChannelEvent shape
channels/qqbot/reconnect.test.ts  6 tests  — backoff/reset/fatal codes/max attempts
channels/qqbot/channel.test.ts   2 tests  — send without targets, channel contract
channels/agent-qq-mail/cli.test.ts 4 tests — send/getEmail/readRecent + error handling
─────────────────────────────────────────
Total: 58 tests, all pass
```

## 迁移历史

| Phase | 内容 | 状态 |
|-------|------|------|
| 1 | 骨架：types + registry + manager + index | ✅ |
| 2 | 飞书迁移：FeishuChannel + config.channels + speak/index 重接线 | ✅ |
| 3a | QQ Bot 底层：token-manager + api | ✅ |
| 3b | QQ Bot 上层：gateway + dispatcher + reconnect + channel | ✅ |
| 4 | Agent QQ Mail：cli + channel | ✅ |
| 5 | Telegram 迁出：channel | ✅ |
| 6 | 清理：内联 Feishu，删除 ws-client/lark-sender/feishu-card | ✅ |
| 7 | 修复：QQBot 发送目标追踪 + Feishu 去 config 单例依赖 | ✅ |

已删除的旧文件：
- `packages/agent/src/tools/feishu/ws-client.ts`
- `packages/agent/src/tools/push/lark-sender.ts`
- `packages/agent/src/tools/push/feishu-card.ts`

## 未来扩展

- QQ Bot 流式消息（C2C `stream_messages`）
- QQ Bot 频道（guild）和富媒体上传
- QQ Bot 扫码配置（onboarding）
- Channel 级别的消息格式化（cards / buttons / embeds）
- Telegram 入站消息接收（webhook 模式）
