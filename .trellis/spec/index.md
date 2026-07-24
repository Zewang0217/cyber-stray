# cyber-stray Spec

> 本目录是项目规范的**唯一真相源**。`.claude/`、`AGENTS.md` 等平台适配文件由 Trellis 从此处派生，勿直接改派生产物。

## 这是什么

cyber-stray 是一只**自进化**的赛博宠物——在互联网上游荡的电子流浪狗。它按自己**不断进化的好奇心**探索与学习（不一定推送），通过一道"主人是否感兴趣"的门控，**主动**把主人会关心的内容推送出去（飞书/Telegram）。背后是 DeepSeek + Vercel AI SDK v6 的 ReAct 循环 + 三层记忆 + Ink TUI + Next.js 仪表盘。

## 核心价值（不可妥协）

让赛博宠物**闭环自进化**：被自己进化的好奇心驱动去探索和学习，并主动推送主人感兴趣的内容。其它子系统（推送渠道/仪表盘/搜索源）都可以失败或替换，但"兴趣会进化 + 能主动推主人感兴趣的内容"这条主轴必须成立。详见 [guides/](guides/index.md)。

## 技术栈

pnpm monorepo（TypeScript strict）：
- **packages/agent** — 核心 agent（Node/tsx 运行；AI SDK v6 + DeepSeek；Ink TUI；Vitest）
- **packages/web** — Next.js 16 + Tailwind 4 + Framer Motion + Three.js（**只读**仪表盘）
- **packages/slides** — Slidev

## 常用命令

```bash
pnpm dev:agent          # 启动 Agent（TUI + 心跳）
pnpm dev:web            # Next.js 开发服务器
pnpm test               # Vitest
pnpm lint               # ESLint
pnpm typecheck          # TS 类型检查
```

## 规范导航

> Trellis 按"层（subdir）"注入包级 spec：`spec/<package>/<layer>/index.md`。

- [agent/core/](agent/core/index.md) — agent 架构 + 开发前 checklist（layer: `core`）
- [agent/core/conventions.md](agent/core/conventions.md) — 工具/记忆/反思/异步的硬约定
- [web/frontend/](web/frontend/index.md) — Web 仪表盘规范（layer: `frontend`，只读契约）
- [guides/](guides/index.md) — 核心价值、架构决策、行为红线、Git 规范、思维指南

## 深度参考

更详尽的代码库分析（ARCHITECTURE / STRUCTURE / CONCERNS / CONVENTIONS / TESTING）归档在 `.planning/codebase/`——旧 GSD 工件，仅作历史参考，不再维护。
