<!-- GSD:project-start source:PROJECT.md -->

## Project

**cyber-stray（赛博街溜子 → 自进化赛博宠物）**

cyber-stray 是一只**自进化**的赛博宠物——一只在互联网上游荡的电子流浪狗。它按自己**不断进化的好奇心**探索与学习（不一定推送），并通过一道"主人是否感兴趣"的门控，**主动**把主人会关心的内容推送出去（飞书/Telegram）。背后是 DeepSeek + Vercel AI SDK v6 驱动的 ReAct 循环，配三层记忆系统、TUI 终端界面与 Next.js Web 仪表盘。

> 当前进化方向：从"定时逛网机器人"升级为"有自我意识的赛博宠物"——闭合 探索→学习→反思→进化兴趣→更懂主人→更会推送 的自进化 loop。

**Core Value:** 让赛博宠物**闭环自进化**：被自己进化的好奇心驱动去探索和学习，并主动推送主人感兴趣的内容。

这是唯一不能妥协的事。其它任何子系统（推送渠道、仪表盘、搜索源）都可以失败或替换，但"兴趣会进化 + 能主动推主人感兴趣的内容"这条主轴必须成立——它驱动所有 tradeoff 决策。

### Constraints

- **Tech stack**：必须沿用 Bun + AI SDK v6 + DeepSeek + 文件系统持久化；记忆层保留人类可读 Markdown（不整体迁 SQLite）—— 已确认的架构决策
- **Architecture**：统一游荡 + 推送门控（不做显式学习/服务双模式分离）；兴趣进化由反思 + 反馈双驱动 —— 已确认
- **Compatibility**：不得破坏现有飞书/Telegram 推送、TUI、Web 仪表盘只读契约；ReAct 工具调用是唯一活决策回路
- **行为规范**：遵循项目 CLAUDE.md——禁止随意兜底（错误就该报错，不用默认值掩盖）；数据库改动须先征得同意；分步骤工作
- **Performance**：反思/检索须借助索引层避免 O(N) 全扫；记忆须有界（接 consolidator/cleanup）

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Vercel AI SDK `generateText` | `ai@6`（已装） | 反思回路 / 推送价值判断的 LLM 调用 | 已是 ReAct 循环底座；反思就是再调一次 `generateText`，复用 `getProvider()`（`src/agent/react.ts:40`）。零新依赖 |
| DeepSeek provider | `@ai-sdk/deepseek@^2`（已装） | 反思 / 判断模型 | 已配置；反思用 `deepseek-chat`，可用较低 temperature 提高一致性 |
| **JSON sidecar 记忆索引**（新建） | — | Markdown 之上的快速检索/反思索引，消除 O(N) 全扫 | 用户已决策"Markdown+索引层"。轻量、可逆、无新运行时依赖。镜像现有 `INDEX.md` 但可查询 |
| **InterestGraph**（新建，JSON 持久化） | — | 替换冻住的 `agentInterests`，带权/可进化兴趣图谱 | 好奇心驱动探索 + 反馈强化的载体；文件持久化契合现有架构 |
| Zod v4 | `zod@4`（已装） | 反思输出 / 兴趣图谱 / 推送判断的结构化校验 | 项目已全面用 Zod 校验工具入参；反思产出同理，防 LLM 胡编 |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `bun:sqlite`（Bun 内置） | 随 Bun | 索引后端（替代 JSON sidecar） | 仅当记忆规模/查询量增长到 JSON 索引吃力时升级；非 v1 必需 |
| BM25 / TF-IDF 关键词评分 | 自实现 | 相关性检索（relevance） | Generative Agents 检索 = recency×importance×**relevance**；cyber-stray 现有只有前两项。关键词评分即可补齐，无需向量 |
| 本地 embedding 模型 | （可选，如 `@xenova/transformers`） | 语义相关性检索 | 仅当关键词检索召回不足时引入；defer 到后续阶段评估 |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `bun test`（已有） | 反思/索引/兴趣图谱的单测 | 复用现有 Bun test runner；反思用 mock `generateText` |
| Context7 | 复核 AI SDK v6 / DeepSeek 反思调用语法 | planning 期对齐当前 API |

## Installation

# v1 无需新增运行时依赖 —— 全部复用现有栈

# 仅当后续评估需要语义检索时：

#   bun add @xenova/transformers   # 本地 embedding（可选，defer）

# 仅当 JSON 索引吃力时改用：

#   （bun:sqlite 已内置，无需安装）

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| JSON sidecar 索引 | 全量迁移 SQLite（bun:sqlite） | 记忆/查询规模增长到 JSON 全量读写成为瓶颈；用户已明确本期不整体迁移 |
| 关键词(BM25)相关性 | 向量 embedding 语义检索 | 关键词召回不足、需要跨词义匹配时；单用户规模通常不需要 |
| 自建反思回路(复用 AI SDK) | Letta/MemGPT 运行时 | 愿意替换整个 agent 框架时——cyber-stray 已有可用的 ReAct loop，不值得 |
| DeepSeek 做反思 | 专用 judge 模型 | 若反思一致性不达标；暂不必要 |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| 外部向量数据库服务(Pinecone 等) | 单用户、记忆量级小；成本/复杂度/网络依赖全不划算 | JSON 索引 + BM25；必要时 bun:sqlite |
| Letta/MemGPT 整体接管 | 强行换掉已跑通的 ReAct loop，迁移成本巨大、收益错位 | 借鉴其分层记忆 + 自编辑思想，在现有栈内实现反思 |
| RAG 检索管线(完整 chunk/embed/store) | 这不是问答检索场景，是 agent 自我记忆；过度工程 | write-manage-read loop 中的 manage 半边 |
| 无界保留所有记忆 | 与自进化相悖——遗忘是特性不是 bug | 接线 consolidator + 周期清理 |

## Stack Patterns by Variant

- 在 JSON 索引里给每条记忆加 `keywords[]`（写入时由 LLM/规则抽取）
- 检索 = 现有 importance×recency × 新增 keyword-relevance
- 因为不加向量，保持可逆、无新依赖
- 兴趣节点带 `weight / lastReinforced / source(reflection|feedback)` 三个字段
- 每次反思/反馈写入带来源，便于"可观测进化"

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `ai@6` | `@ai-sdk/deepseek@^2` | 已在用；反思调用与 ReAct 同 API 面 |
| Zod v4 | AI SDK tool schema | 已在用；反思输出 schema 复用同一 Zod 习惯 |

## Sources

- Generative Agents（Park et al. 2023, arXiv:2304.03442）— memory stream + reflection + recency×importance×relevance 检索（HIGH，权威）
- MemGPT / Letta（arXiv:2310.08560，letta.com/blog/agent-memory）— 分层记忆 + LLM 自管理记忆（HIGH）
- "Memory for Autonomous LLM Agents"（arXiv:2603.07670）— write-manage-read loop 分类法（HIGH，直接印证架构缺口）
- 本地 SQLite 记忆实践（sqlite-memory、memweave、dev.to SQLite-as-vector）— BM25+向量混合检索是本地 agent 记忆甜点（MEDIUM）
- "You don't need a vector DB for agent memory"（Medium/samarthgupta1911）— 小规模关键词足矣（MEDIUM）

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

| Skill | Description | Path |
|-------|-------------|------|
| guizang-ppt-skill | 生成"电子杂志 × 电子墨水"风格的横向翻页网页 PPT（单 HTML 文件），含 WebGL 流体背景、衬线标题 + 非衬线正文、章节幕封、数据大字报、图片网格等模板。当用户需要制作分享 / 演讲 / 发布会风格的网页 PPT，或提到"杂志风 PPT"、"horizontal swipe deck"、"editorial magazine"、"e-ink presentation"时使用。 | `.agents/skills/guizang-ppt-skill/SKILL.md` |
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
