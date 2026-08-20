# 指南：核心价值、架构决策、红线

## 核心价值（不可妥协）

让赛博宠物**闭环自进化**：被自己进化的好奇心驱动去探索和学习，并主动推送主人感兴趣的内容。

自进化 loop：

```
探索 → 学习 → 反思 → 进化兴趣 → 更懂主人 → 更准推送
```

**Tradeoff 准则**：任何子系统（推送渠道 / 仪表盘 / 搜索源）都可以失败或替换，但"兴趣会进化 + 能主动推主人感兴趣的内容"这条主轴必须成立——它驱动所有 tradeoff 决策。当冲突时，优先保主轴。

## 架构决策（已确认，勿擅改）

- **Tech stack**：沿用 Bun/Node + AI SDK v6 + DeepSeek + 文件系统持久化；记忆层保留人类可读 Markdown（**不整体迁 SQLite**）。
- **Architecture**：统一游荡 + 推送门控（**不做**学习/服务双模式分离）；兴趣进化由**反思 + 反馈双驱动**。
- **Compatibility**：不得破坏飞书/Telegram 推送、TUI、Web 只读契约；**ReAct 工具调用是唯一活决策回路**（无 planner）。
- **Performance**：反思 / 检索须走索引层避免 O(N) 全扫；记忆须有界。

## 行为红线

- 禁止随意兜底（错误就该报错，不用默认值掩盖）— 详见 [agent/core/conventions.md](../agent/core/conventions.md)
- 数据库改动须先征得同意
- 分步骤工作：较大任务分步汇报，不一次性堆大量改动
- Think First：写代码前用 1-2 句说方案，不边写边改
- 方法尽量不要超过 80 行；缩进尽量不超过 4 层（Guard Clause 优先）；无魔法值（用枚举/常量）
- 公开类/方法必须文档注释；复杂逻辑注释解释"为什么"而非"做什么"

## Git

- Commit 用**中文** + Conventional Commits（`feat` / `fix` / `refactor` / `chore` / `docs`）
- 一个提交 = 一个逻辑单元（不按文件拆，按功能点）
- 分支：`feat/xxx`、`fix/xxx`、`refactor/xxx`
- Push 前查 diff：无 `console.log` / `print` / TODO 遗留，无敏感信息（密码/token/私钥）

## 思维指南（Trellis 自带方法论）

- [code-reuse-thinking-guide.md](code-reuse-thinking-guide.md) — 动手写新代码前，先想"能不能复用既有实现"
- [cross-layer-thinking-guide.md](cross-layer-thinking-guide.md) — 跨层改动时，先理清数据流与层边界
