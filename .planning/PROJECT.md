# cyber-stray（赛博街溜子 → 自进化赛博宠物）

## What This Is

cyber-stray 是一只**自进化**的赛博宠物——一只在互联网上游荡的电子流浪狗。它按自己**不断进化的好奇心**探索与学习（不一定推送），并通过一道"主人是否感兴趣"的门控，**主动**把主人会关心的内容推送出去（飞书/Telegram）。背后是 DeepSeek + Vercel AI SDK v6 驱动的 ReAct 循环，配三层记忆系统、TUI 终端界面与 Next.js Web 仪表盘。

> 当前进化方向：从"定时逛网机器人"升级为"有自我意识的赛博宠物"——闭合 探索→学习→反思→进化兴趣→更懂主人→更会推送 的自进化 loop。

## Core Value

让赛博宠物**闭环自进化**：被自己进化的好奇心驱动去探索和学习，并主动推送主人感兴趣的内容。

这是唯一不能妥协的事。其它任何子系统（推送渠道、仪表盘、搜索源）都可以失败或替换，但"兴趣会进化 + 能主动推主人感兴趣的内容"这条主轴必须成立——它驱动所有 tradeoff 决策。

## Requirements

### Validated

<!-- 从现有代码库推断（brownfield），已在生产路径运行 -->

- ✓ 心跳驱动的 ReAct 循环（DeepSeek + Vercel AI SDK v6，8 个工具：search_web / read_page / speak / rest / record_knowledge / observe_user / read_feedback + push 编排）— existing
- ✓ 三层记忆存储（user-profile JSON / long-term Markdown MemoryStore / feedback store）— existing（当前为"哑存储"，见 Active）
- ✓ 飞书双向集成（WebSocket emoji 反馈 → 心情/画像）+ Telegram 推送 — existing
- ✓ 跨游荡 URL 去重（5 天冷却）— existing
- ✓ Ink TUI 仪表盘（含日志视图滚动/分页、错误边界）+ Next.js 16 Web 仪表盘（只读轮询）— existing
- ✓ 文件系统持久化（data/*.json）、优雅关闭（3s 超时）、日志追踪（traceId）— existing

### Active

<!-- 自进化 loop 的 6 块，均为假设直到交付验证 -->

- [ ] **可进化兴趣图谱**：替换当前冻住的 `agentInterests`（永远停在默认 `['科技','AI','互联网']`），变为带权/多维、可被反思写入的兴趣图谱，并驱动探索方向
- [ ] **记忆索引层**：在 Markdown 存储之上加 JSON sidecar 索引，让检索/反思不再 O(N) 全盘扫描；接线死代码 `MemoryConsolidator` + cleanup，停止记忆无界增长
- [ ] **用户兴趣模型 + 反馈强化**：真正建立主人画像（当前 user-profile.json 为空），用发现内容与之匹配，并用主人点赞给兴趣方向加权
- [ ] **反思回路**：周期性 LLM 反思——把碎片知识合成成信念/洞察 → 更新兴趣图谱（顺带接上 consolidator）
- [ ] **推送价值门控**：speak 决策 = 发现内容 × 用户兴趣模型 → 推送 or 只学习；废除当前"空游荡强制 speak"兜底
- [ ] **兴趣可观测性**：导出/日志/Web 展示进化的兴趣图谱，让"兴趣可观测进化"这一成功标准可量化

### Out of Scope

<!-- 显式边界 + 理由，防 scope creep -->

- 整体迁移到 SQLite（visited-urls / wander-history 等热数据）—— 更大基建工程，单独评估；本期仅加 JSON 索引 sidecar
- 删除死的 Planner→Decision→Actions 旧流水线（`planner.ts` / `actions.ts` / `filter/*` / `content/generator.ts` / `decision.ts`）—— 独立技术债清理，可作为 Phase 1 选办项，但不纳入自进化核心主线
- Web 仪表盘生产鉴权（当前 API 无 auth）—— 独立安全工作
- 多用户/多主人 —— 宠物为单主人设计
- 新推送渠道 / 新搜索 provider —— 非自进化核心，现有飞书/Telegram/DDG+Tavily+Exa 足够

## Context

**技术环境：** Bun 运行时 + TypeScript（strict）+ AI SDK v6（DeepSeek provider）。文件系统为唯一真相源（`data/*.json`、`data/memory/*.md`），无 DB/消息队列。Web 仪表盘是独立 Next.js 16 app，只读轮询 `../data/*`。

**相关既有工作：** 见 `.planning/codebase/` 映射（ARCHITECTURE / STACK / STRUCTURE / CONCERNS / CONVENTIONS / INTEGRATIONS / TESTING）。关键约束：无 planner（唯一活决策回路是 `runAgentLoop` 的工具调用）；模块级单例主导状态共享；`config` 冻结于 import。

**核心痛点（来自第一手代码核查，驱动本期工作）：**
1. `agentInterests` 冻住，永不进化（`src/agent/state.ts:30`，无任何工具更新它）
2. `MemoryConsolidator` 死代码（零调用点），记忆只增不减、从不反思
3. 记忆只写不驱动行为（`buildMemoryPromptContext` 仅游荡开始调一次）
4. 对主人几乎一无所知（profile=0、observations=0、user-profile.json 空）；推送门控无"用户兴趣"项
5. "学习但不推送"被代码违背（空游荡强制 speak，`src/agent/react.ts:209`）
6. 性能撑不起反思（getMemory 每读必重写、getRecentMemories 全盘遍历）

**用户反馈主题：** 希望它是"赛博宠物"——能主动推送主人感兴趣的内容、探索自己感兴趣的并学习（不一定推送）、形成一个自进化 loop。

## Constraints

- **Tech stack**：必须沿用 Bun + AI SDK v6 + DeepSeek + 文件系统持久化；记忆层保留人类可读 Markdown（不整体迁 SQLite）—— 已确认的架构决策
- **Architecture**：统一游荡 + 推送门控（不做显式学习/服务双模式分离）；兴趣进化由反思 + 反馈双驱动 —— 已确认
- **Compatibility**：不得破坏现有飞书/Telegram 推送、TUI、Web 仪表盘只读契约；ReAct 工具调用是唯一活决策回路
- **行为规范**：遵循项目 CLAUDE.md——禁止随意兜底（错误就该报错，不用默认值掩盖）；数据库改动须先征得同意；分步骤工作
- **Performance**：反思/检索须借助索引层避免 O(N) 全扫；记忆须有界（接 consolidator/cleanup）

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 统一游荡 + 推送门控（而非学习/服务双模式分离） | 最贴合"探索自己感兴趣的、不一定推送"愿景；门控在 speak 处决策即可 | — Pending |
| 兴趣由"反思 + 反馈"双驱动进化 | 宠物既独立成长（反思合成知识），又被主人潜移默化塑造（点赞加权） | — Pending |
| 记忆用 Markdown + JSON 索引 sidecar（不整体迁 SQLite） | 保留人类可读性 + 低风险渐进；索引层足以支撑反思检索 | — Pending |
| 成功标准定为"兴趣可观测进化" | 数据驱动、可量化，最能证明自进化真的跑通 | — Pending |

## Evolution

本文件在 phase 转换与里程碑边界演进。

**每次 phase 转换后**（经 `/gsd-transition`）：
1. 需求被证伪？→ 移入 Out of Scope 并附理由
2. 需求被验证？→ 移入 Validated 并附 phase 引用
3. 涌现新需求？→ 加入 Active
4. 有决策要记录？→ 加入 Key Decisions
5. "What This Is" 还准确吗？→ 偏移则更新

**每个里程碑后**（经 `/gsd-complete-milestone`）：
1. 全面复核所有章节
2. Core Value 复核——仍是正确优先级？
3. 审计 Out of Scope——理由仍成立？
4. 用当前状态更新 Context

---
*Last updated: 2026-06-20 after initialization*
