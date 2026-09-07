# cyber-stray

> 自进化赛博宠物：被自己进化的好奇心驱动探索与学习，并主动推送主人感兴趣的内容（飞书/Telegram）。DeepSeek + AI SDK v6 ReAct 循环 + 三层记忆 + Ink TUI + Next.js 仪表盘。
>
> **核心价值（不可妥协）**：闭环自进化——兴趣会进化 + 能主动推主人感兴趣的内容。其它子系统（推送渠道/仪表盘/搜索源）可失败或替换，这条主轴必须成立，驱动所有 tradeoff。

## 规范

项目规范的**唯一真相源**在 [`.trellis/spec/`](../.trellis/spec/index.md)（Trellis 管理，跨平台同步到 OpenCode）。写代码前读对应包的 spec：

- **agent 包** → `.trellis/spec/agent/core/`（`index.md` 架构 + 开发前 checklist；`conventions.md` 硬约定：禁 execSync / 禁兜底 / 索引复用 / grounding）
- **web 包** → `.trellis/spec/web/frontend/`（**只读契约**：绝不写 agent 数据）
- **共享** → `.trellis/spec/guides/`（核心价值、架构决策、行为红线、Git 规范、思维指南）

> 旧 GSD 工件归档在 `.planning/`（仅历史参考，不再维护）。

## 常用命令

```bash
pnpm dev:agent          # 启动 Agent（TUI + 心跳）
pnpm dev:web            # Next.js 开发服务器
pnpm test               # Vitest
pnpm lint               # ESLint
pnpm typecheck          # TS 类型检查
```

## 分支流程（硬规则，ADR-0009）

- **只在 develop 分支开发**：功能/修复分支从 develop 切出 → PR 合并到 **develop**（CI 只对 base=develop 的 PR 跑质量门）。
- **开发前必拉**：每次开始开发前先 `git fetch origin` 并检查 develop 有无新改动——有则 `git pull --ff-only origin develop`（或 rebase 到最新 develop），确保基于最新 develop 开发，避免合并冲突堆叠。
- 发布 = 单独 PR（develop → main，squash 合并，不重复跑质量门；main 保护要求 Approve + 管理员合并）。
- 禁止直接向 main 提功能 PR（main 只接受 develop 的发布 PR）。
