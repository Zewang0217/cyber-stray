# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

```bash
# Agent 运行
bun run dev             # 启动 Agent（TUI + 内嵌心跳）
bun test                # 运行所有测试（Bun test runner）
bun run lint            # ESLint 检查
bun run typecheck       # TypeScript 类型检查

# Web Dashboard
cd web && bun run dev   # 启动 Next.js 开发服务器
cd web && bun run build # 生产构建
cd web && bun run lint  # ESLint 检查
```

## 架构概览

```
src/index.ts (入口)
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
| ReAct Loop | `src/agent/react.ts` | Vercel AI SDK 驱动的 ReAct 循环 |
| 状态管理 | `src/agent/state.ts` | 无聊/精力/心情/temper，持久化到 JSON |
| 工具注册 | `src/tools/registry/` | 工厂模式，将工具包装为 AI SDK 兼容的 tool |
| 搜索适配 | `src/tools/search/` | DuckDuckGo / Tavily / Exa，统一 SearchAdapter 接口 |
| 记忆系统 | `src/memory/long-term/` | 文件系统 Markdown 存储，INDEX.md 索引 |
| LLM 客户端 | `src/llm/` | DeepSeek provider via @ai-sdk/deepseek |
| 推送通知 | `src/tools/registry/speak.ts` | 飞书 Webhook / Telegram Bot |
| TUI | `src/tui/` | Ink (React for terminal) 终端界面 |
| Web 仪表盘 | `web/` | Next.js 16 + Tailwind 4 + Framer Motion |

### ReAct Loop 流程

LLM 每步自主选择工具调用：`search_web` → `read_page` → `speak`（推送）→ 继续搜索或 `rest()` 结束。无显式 Planner——决策完全由 LLM 在 ReAct 循环中做出。

### 记忆系统三层架构

- **用户画像** (`src/memory/user-profile.ts`) — 偏好/信心/反馈追踪
- **长期记忆** (`src/memory/long-term/`) — MemoryStore 类，Markdown 文件存储，支持 CRUD/评分/令牌预算
- **记忆上下文** — `buildMemoryContext()` 构建注入 prompt 的上下文

### 搜索适配器模式

`src/tools/search/index.ts` 根据 `config.searchProvider` 选择适配器，所有适配器实现 `SearchAdapter` 接口。DuckDuckGo 为免费默认，Tavily/Exa 为付费选项。

## 配置文件

- **行为配置**: `data/agent-config.json` — 心跳间隔、无聊增长率、温度等，缺失字段回退默认值
- **环境变量**: `.env` — `DEEPSEEK_API_KEY`、`TAVILY_API_KEY`、`EXA_API_KEY`、`FEISHU_WEBHOOK`、`TELEGRAM_BOT_TOKEN`
- **数据存储**: `data/state.json`（Agent 状态）、`data/memory/`（长期记忆）、`data/history/`（推送历史）

## 技术栈

- **运行时**: Bun
- **语言**: TypeScript (strict mode)
- **AI**: Vercel AI SDK v6 + DeepSeek Provider
- **终端 UI**: Ink (React for CLI)
- **验证**: Zod v4
- **前端**: Next.js 16 + Tailwind CSS 4 + Framer Motion + Three.js
- **视觉规范**: Catppuccin 色彩系统（DESIGN.md 定义）
