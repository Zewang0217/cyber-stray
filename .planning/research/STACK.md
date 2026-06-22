# Stack Research

**Domain:** 自进化自主 LLM agent — 长期记忆 + 反思(reflection)+ 好奇心(curiosity)
**Researched:** 2026-06-20
**Confidence:** HIGH（反思/记忆范式有 Generative Agents / MemGPT 等权威来源）；库版本 MEDIUM（需在 planning 时用 Context7 复核）

## Recommended Stack

> 核心原则：**复用 cyber-stray 已有栈**（Bun + AI SDK v6 + DeepSeek + 文件系统 Markdown），只新增"manage"半边所需的最小件。不引入新运行时、不换 agent 框架。

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

```bash
# v1 无需新增运行时依赖 —— 全部复用现有栈
# 仅当后续评估需要语义检索时：
#   bun add @xenova/transformers   # 本地 embedding（可选，defer）
# 仅当 JSON 索引吃力时改用：
#   （bun:sqlite 已内置，无需安装）
```

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

**若反思召回需更精准：**
- 在 JSON 索引里给每条记忆加 `keywords[]`（写入时由 LLM/规则抽取）
- 检索 = 现有 importance×recency × 新增 keyword-relevance
- 因为不加向量，保持可逆、无新依赖

**若兴趣图谱需要可解释：**
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

---
*Stack research for: 自进化赛博宠物（长期记忆 + 反思 + 好奇心）*
*Researched: 2026-06-20*
