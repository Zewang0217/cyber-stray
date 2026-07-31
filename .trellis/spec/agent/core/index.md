# Agent Core 开发规范

> `packages/agent` 的核心运行时：ReAct 循环、工具、三层记忆、反思、兴趣图谱、推送门控、Ink TUI。

## 架构

入口 `packages/agent/src/index.ts`：

```
config 验证 → loadState() → startHeartbeat()
  → heartbeat() 更新无聊/精力值
  → runAgentLoop()（ReAct Loop）
    → LLM(DeepSeek) 决定行动 → 工具执行 → 循环直到 rest() 或 maxSteps
```

## 核心模块

| 模块 | 路径 | 职责 |
|---|---|---|
| ReAct Loop | `agent/react.ts` | AI SDK `generateText` 驱动；`stopWhen=[hasToolCall('rest'), stepCountIs(maxSteps)]` |
| 状态 | `agent/state.ts` | 无聊/精力/心情/temper，持久化 JSON |
| 工具注册 | `tools/registry/` | `ToolDefinition` 工厂 → AI SDK `tool`；`auto-register.ts` 静态数组注册 |
| 搜索 | `tools/search/` | DuckDuckGo / Tavily / Exa，统一 `SearchAdapter` |
| 记忆 | `memory/long-term/` | `MemoryStore`（Markdown 三写）+ `MemoryIndex`（JSON sidecar） |
| 反思 | `memory/reflection/` | `ReflectionEngine`（单轮 generateText）+ `Scheduler`（异步，每 5 游荡 / 4h） |
| 兴趣图谱 | `InterestGraph` | 带权图谱，反思/反馈双驱动，持久化 `data/interests.json` |
| 推送门控 | `PushGate` | speak 前评分（兴趣×偏好×质量），不够则只学不推 |
| LLM | `llm/` | DeepSeek provider（`@ai-sdk/deepseek`） |
| 推送 | `tools/registry/speak.ts` | 飞书 Webhook / Telegram |
| TUI | `tui/` | Ink（React for terminal） |

## 记忆三层

- **用户画像** `memory/user-profile.ts` — likes/dislikes/confidence/sampleCount
- **长期记忆** `memory/long-term/` — `MemoryStore`：Markdown（真相源）+ `INDEX.md`（人类导航）+ `.index.json`（查询索引）
- **记忆上下文** — `buildMemoryContext()` 构建注入 prompt 的上下文

## 数据与配置

- `data/agent-config.json` — 心跳间隔 / 无聊增长率 / 温度 / 各类阈值
- `.env` — `DEEPSEEK_API_KEY` / `TAVILY_API_KEY` / `EXA_API_KEY` / `FEISHU_WEBHOOK` / `TELEGRAM_BOT_TOKEN`
- 运行时数据：`data/state.json`、`data/memory/`、`data/history/`、`data/interests.json`

## Pre-Development Checklist

写 agent 代码前，先读 [conventions.md](conventions.md)，确认：

- [ ] **路径**：数据文件走 `getDataPath()`，且不写成模块级常量（会破坏测试隔离）
- [ ] **异步**：禁 `execSync`（耗时 I/O 用 `execFile`/`spawn` + `AbortController`）
- [ ] **错误**：禁兜底（抛明确异常，不用默认值/降级/推断掩盖）
- [ ] **记忆**：索引复用 `MemoryIndex`（不另建）；grounding（洞察必引真实 `sourceIds`）不得绕过；provenance 标记正确
- [ ] **工具**：语义级粒度；新增 category 同步改 `tool-prompt.ts` 两处
- [ ] **DB 改动须先征得同意**；最小变更；Zod 校验 LLM 产出
