# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

```bash
# Agent 运行
pnpm dev:agent           # 启动 Agent（TUI + 内嵌心跳）
pnpm test                # 运行所有测试（Vitest）
pnpm lint                # ESLint 检查
pnpm typecheck           # TypeScript 类型检查

# Web Dashboard
pnpm dev:web             # 启动 Next.js 开发服务器
pnpm --filter @cyber-stray/web build   # 生产构建
pnpm --filter @cyber-stray/web lint    # ESLint 检查

# Slides
pnpm dev:slides          # 启动 Slidev
```

## 架构概览 — pnpm Monorepo

```
packages/agent/src/index.ts (入口)
  → config 验证 → loadState() → startHeartbeat()
    → heartbeat() 更新无聊/精力值
    → runAgentLoop() (ReAct Loop)
      → LLM (DeepSeek) 决定行动
      → 工具执行 (搜索/阅读/推送/记忆/休息)
      → 循环直到 rest() 或达到 maxSteps
```

### 核心模块

| 模块 | 路径 | 职责 |
|------|------|------|
| ReAct Loop | `packages/agent/src/agent/react.ts` | Vercel AI SDK 驱动的 ReAct 循环 |
| 状态管理 | `packages/agent/src/agent/state.ts` | 无聊/精力/心情/temper，持久化到 JSON |
| 工具注册 | `packages/agent/src/tools/registry/` | 工厂模式，将工具包装为 AI SDK 兼容的 tool |
| 搜索适配 | `packages/agent/src/tools/search/` | DuckDuckGo / Tavily / Exa，统一 SearchAdapter 接口 |
| 记忆系统 | `packages/agent/src/memory/long-term/` | 文件系统 Markdown 存储，INDEX.md 索引 |
| LLM 客户端 | `packages/agent/src/llm/` | DeepSeek provider via @ai-sdk/deepseek |
| 推送通知 | `packages/agent/src/tools/registry/speak.ts` | 飞书 Webhook / Telegram Bot |
| TUI | `packages/agent/src/tui/` | Ink (React for terminal) 终端界面 |
| Web 仪表盘 | `packages/web/` | Next.js 16 + Tailwind 4 + Framer Motion |

### 记忆系统三层架构

- **用户画像** (`packages/agent/src/memory/user-profile.ts`) — 偏好/信心/反馈追踪
- **长期记忆** (`packages/agent/src/memory/long-term/`) — MemoryStore 类，Markdown 文件存储
- **记忆上下文** — `buildMemoryContext()` 构建注入 prompt 的上下文

## 配置文件

- **行为配置**: `data/agent-config.json` — 心跳间隔、无聊增长率、温度等
- **环境变量**: `.env` — `DEEPSEEK_API_KEY`、`TAVILY_API_KEY`、`EXA_API_KEY`、`FEISHU_WEBHOOK`、`TELEGRAM_BOT_TOKEN`
- **数据存储**: `data/state.json`、`data/memory/`、`data/history/`

## 技术栈

- **运行时**: Node.js (agent 用 tsx 运行 TS)
- **包管理**: pnpm workspace
- **语言**: TypeScript strict
- **AI**: Vercel AI SDK v6 + DeepSeek Provider
- **测试**: Vitest v3
- **终端 UI**: Ink (React for CLI)
- **前端**: Next.js 16 + Tailwind CSS 4 + Framer Motion + Three.js
