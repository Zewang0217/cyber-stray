# cyber-stray AGENTS.md

> 本仓库的 agent 行为入口。与全局 `~/.agents/AGENTS.md` 的通用准则冲突时，以本文件为准。

## 项目本质

自进化赛博宠物：被自己进化的好奇心驱动探索与学习，并主动推送主人感兴趣的内容（飞书/Telegram）。

- **主轴（不可妥协）**：兴趣会进化 + 能主动推主人感兴趣的内容。推送渠道 / 仪表盘 / 搜索源都可失败或替换；一切 tradeoff 保主轴。
- 技术栈：pnpm monorepo — `packages/agent`（Node/tsx，ReAct 循环 + 三层记忆 + Ink TUI）、`packages/web`（Next.js 仪表盘）、`packages/slides`（Slidev）。

## 规范真相源：`.trellis/spec/`

仓库规范的**唯一真相源**在 `.trellis/spec/`（`.claude/CLAUDE.md` 等平台适配文件由它派生，勿直接改派生产物）。动手前按改动范围读：

- 改 `packages/agent` → `agent/core/`：架构 + 开发前 checklist + `conventions.md` 硬约定
- 改 `packages/web` → `web/frontend/`：**只读契约**——仪表盘绝不写 agent 数据
- 全局决策 / 行为红线 / 思维指南 → `guides/`

## 硬约定（写 agent 代码必守，源自 agent/core/conventions.md）

- **禁兜底**：错误抛明确异常，不用默认值 / 降级 / 推断掩盖
- **路径**：数据一律走 `getDataPath()`；禁模块级路径常量（import 时求值会把测试写穿生产数据）
- **异步**：禁 `execSync`（卡死事件循环——心跳 / TUI / 反思调度全停摆）；I/O 用 `fs/promises`
- **grounding**：反思洞察必引 ≥1 条真实 `sourceIds`，无源整条丢弃，不得绕过
- **记忆**：索引复用 `MemoryIndex`，不另建并行索引；provenance 标记 `untrusted:web` / `self:reflection` / `self:action`
- **DB 改动先征得同意**；LLM 产出用 Zod 校验
- 方法 ≤ 50 行；缩进 ≤ 3 层（Guard Clause 优先）；无魔法值；公开 API 写"为什么"注释

## 常用命令

```bash
pnpm dev:agent     # Agent（TUI + 心跳）
pnpm dev:web       # Next.js 仪表盘
pnpm dev:slides    # Slidev
pnpm test          # Vitest
pnpm lint          # ESLint
pnpm typecheck     # TS 类型检查
pnpm setup:browser # 安装 agent-browser CLI
```

## 工作流程

1. **读 spec** → 验收：能说出本次改动涉及哪几条硬约定
2. **Think First**：动手前用 1-2 句说清方案 → 验收：方案先说出口，不是边写边改
3. **最小变更**：只动该动的，优先复用既有实现（见 `guides/code-reuse-thinking-guide.md`）→ 验收：diff 只含任务直接相关的行
4. **分步推进**：较大任务分步汇报，不一次性堆大量改动 → 验收：每一步独立可验证
5. **验证** → 验收：改动范围的 `pnpm test` / `lint` / `typecheck` 通过；UI 改动在浏览器实测；push 前 diff 无 `console.log` / TODO / 敏感信息

## Git

- Commit 中文 + Conventional Commits（`feat` / `fix` / `refactor` / `chore` / `docs`）
- 一个提交 = 一个逻辑单元（按功能点，不按文件）
- 分支：`feat/xxx`、`fix/xxx`、`refactor/xxx`、`chore/xxx`；PR 目标默认 `develop`

## Agent skills

### Issue tracker

Issues 存于 GitHub Issues，用 `gh` CLI 操作（创建/读取/评论/标签）。见 `docs/agents/issue-tracker.md`。

### Triage labels

五个规范角色用同名标签：`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文：根 `CONTEXT.md`（领域词汇）+ `docs/adr/`（架构决策）。见 `docs/agents/domain.md`。