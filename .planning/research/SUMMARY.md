# Project Research Summary

**Project:** cyber-stray（赛博街溜子 → 自进化赛博宠物）
**Domain:** 自进化自主 LLM agent — 长期记忆 + 反思 + 好奇心
**Researched:** 2026-06-20
**Confidence:** HIGH

## Executive Summary

cyber-stray 已有完整的 ReAct 游荡回路与一套文件式长期记忆（Markdown + frontmatter + INDEX.md），但它的记忆系统停在了"**只记不想**"阶段。学术界的权威框架把 agent 记忆抽象为 **write-manage-read loop**（arXiv:2603.07670）：写（record_*）、管（反思/合并/遗忘）、读（检索注入）。第一手代码核查确认：cyber-stray 已实现 write 与 read，**唯独缺 manage 半边** —— `MemoryConsolidator` 是零调用点的死代码、`agentInterests` 永远冻在出厂默认值、记忆无界增长。这正是它成不了"自进化赛博宠物"的根因。

推荐路线是 **不换栈、不换框架**，在现有 Bun + AI SDK v6 + DeepSeek + Markdown 之上，补齐 manage 半边：加一个 JSON 索引 sidecar（让反思/检索不再 O(N) 全扫）、一个可进化兴趣图谱（替换冻住的 agentInterests，由"反思 + 反馈"双驱动）、一个周期性反思回路（复用 `generateText` 把碎片合成成洞察、顺带接线 consolidator），以及一道推送价值门控（内容 × 用户兴趣模型，替换强制 speak）。这套方案直接对应 Generative Agents（Park et al. 2023）的 memory stream + reflection，以及 MemGPT/Letta 的自管理记忆思想，但用 cyber-stray 已有的轻量文件栈实现，避免引入向量库或整体换框架。

主要风险集中在 LLM 反思的固有失败模式：**反思幻觉**（编造无源洞察）、**兴趣坍缩**（正反馈收敛到单一话题）、**反思自激**（反思读旧反思导致抽象失控）、**学习内容 injection**（不可信网页成记忆后污染行为）。研究为每类都给出了可落地的防护（grounding 引用源、权重衰减 + novelty、反思只读原始观察、provenance 标记），并映射到具体 phase。

## Key Findings

### Recommended Stack

详见 [STACK.md](./STACK.md)。核心：**零新增运行时依赖**，全部复用现有栈 —— AI SDK `generateText` 跑反思、DeepSeek 做判断模型、Zod 校验反思/兴趣产出、新增一个 JSON sidecar 索引 + 兴趣图谱 JSON 持久化。向量库/embedding/SQLite 整体迁移均判定为过度工程，defer。

**Core technologies:**
- **AI SDK `generateText` + DeepSeek（已有）**：反思回路与推送判断的 LLM 调用，复用 `getProvider()`
- **JSON sidecar 记忆索引（新）**：Markdown 之上的快速检索，消除 O(N) 全扫
- **InterestGraph（新，JSON 持久化）**：带权/可进化兴趣图谱，替换冻住 agentInterests
- **Zod v4（已有）**：反思产出/兴趣/门控的结构化校验，防胡编

### Expected Features

详见 [FEATURES.md](./FEATURES.md)。

**Must have（table stakes，manage 半边）：**
- 反思：周期性合成记忆为更高阶洞察（Generative Agents 核心）
- 相关性检索：recency×importance×**relevance**（现缺 relevance）
- 有界记忆：合并 + 遗忘（consolidator 接线）
- 记忆驱动行为：检索结果 + 进化兴趣驱动探索

**Should have（差异化，对齐 Core Value）：**
- 可进化兴趣图谱（反思 + 反馈双驱动）
- 好奇心驱动探索（intrinsic motivation / novelty）
- 推送价值门控 + 废除强制 speak
- 兴趣可观测性

**Defer（v2+）：** 语义向量检索、SQLite 索引迁移、多 agent 社会、完全自主目标设定。

### Architecture Approach

详见 [ARCHITECTURE.md](./ARCHITECTURE.md)。组织模型 = write-manage-read loop。在现有 wander（write+read）之外，新增独立、异步的 **manage 半边**（ReflectionEngine + 接线 Consolidator），产出去更新 InterestGraph 与洞察记忆；speak 前插入 PushGate。

**Major components:**
1. **MemoryIndex（新）** — JSON sidecar，O(1) 查表支撑反思/检索
2. **ReflectionEngine（新）** — 周期 LLM 合成 → 洞察记忆 + 更新兴趣；异步于游荡
3. **InterestGraph（新）** — 替换冻住 agentInterests，带权/来源/衰减
4. **PushGate（新）** — 内容 × UserProfile → 推 or 只学；替换强制 speak
5. **MemoryConsolidator（接线）** — 合并/清理/过期，有界化
6. **UserProfile（填充 + 强化）** — 当前空，补 + 反馈加权

### Critical Pitfalls

详见 [PITFALLS.md](./PITFALLS.md)。Top 5：
1. **反思幻觉** — 洞察必须引用源 memoryId + Zod 校验，无源即丢弃（不兜底）
2. **兴趣坍缩** — 权重时间衰减 + novelty 探索预算 + 单兴趣上限
3. **反思自激** — 反思只读原始观察类，排除 insight 类 + 节奏上限
4. **学习内容 injection** — 记忆带 provenance（untrusted:web），门控降权 + 内容扫描
5. **记忆无界增长（现存 bug）** — 接线 consolidator + cleanupVisitedUrls，周期执行

## Implications for Roadmap

基于研究，建议 **6 个 phase**（依赖序，每 phase 推进一个可观测的 loop 能力，契合 MVP 模式）：

### Phase 1: 记忆基础设施
**Rationale:** 反思/检索的前提是高效的索引与有界记忆；现有 O(N) 全扫 + consolidator 死代码会直接卡死 manage 半边。这是 write-manage-read 的地基。
**Delivers:** JSON 索引 sidecar（MemoryIndex）、接线 MemoryConsolidator + cleanupVisitedUrls、废除空 catch 习惯、废除/改造空游荡强制 speak、修阻塞性 bug（LLM 统计恒 0）。
**Addresses:** table stakes「有界记忆」「相关性检索（索引前提）」
**Avoids:** 陷阱 #6（无界增长）、#7（静默失败）；性能陷阱（O(N) 全扫）

### Phase 2: 可进化兴趣图谱
**Rationale:** loop 的"自我"载体；agentInterests 冻住是自进化最致命缺口，先有可写图谱才能谈进化。
**Delivers:** InterestGraph（带权/来源/lastReinforced/衰减），替换 state.agentInterests；注入 prompt 驱动探索方向。
**Uses:** Zod 校验、JSON 持久化
**Avoids:** 陷阱 #2（兴趣坍缩）—— 内置衰减 + novelty + 上限

### Phase 3: 用户兴趣模型 + 反馈强化
**Rationale:** 推送门控需要"主人喜欢什么"的依据；当前 user-profile.json 空。反馈强化也是兴趣进化的双驱动之一。
**Delivers:** 填充 UserProfile（带置信度）、反馈 → 画像/兴趣加权。
**Avoids:** 陷阱 #3（反馈偏差）—— 置信度 + 探索预算

### Phase 4: 反思回路
**Rationale:** manage 半边的核心，闭合 loop 的关键（碎片→洞察→兴趣进化）。依赖 Phase 1 索引与 Phase 2 兴趣图谱。
**Delivers:** ReflectionEngine（周期、异步），合成洞察记忆 + 更新兴趣；接线 consolidator 周期执行。
**Avoids:** 陷阱 #1（幻觉，grounding）、#4（自激，只读原始观察）、#5 前半（provenance 标记）

### Phase 5: 推送价值门控
**Rationale:** "主动推送主人感兴趣的内容" = Core Value 的出口；依赖兴趣图谱 + 用户模型。
**Delivers:** PushGate（内容 × UserProfile × 兴趣 → 推送价值分），替换/废除强制 speak 兜底；阈值可配置 + 反馈校准。
**Avoids:** 陷阱 #8（过严/过松）、#5 后半（内容扫描）

### Phase 6: 兴趣可观测性 + 闭环验证
**Rationale:** 成功标准 = "兴趣可观测进化"；需要把进化过程量化、可观测，并端到端验证 loop。
**Delivers:** 兴趣图谱演化导出/日志/Web 展示；坍缩检测；端到端验证。
**Avoids:** 陷阱 #2 验证（坍缩检测）

### Phase Ordering Rationale

- **Phase 1 必须最先**：索引层与有界记忆是反思/检索的硬前置（依赖：反思 requires 索引）
- **Phase 2/3 可在 Phase 1 后**：兴趣图谱与用户模型是反思/门控的输入，互相弱依赖
- **Phase 4 依赖 1+2**：反思需索引高效读、需兴趣图谱承接更新
- **Phase 5 依赖 2+3**：门控需兴趣 + 用户模型
- **Phase 6 收尾**：可观测性横跨 2/4/5，放最后端到端验证
- 全程避开"反思内联进游荡热路径"反模式（manage 独立异步）

### Research Flags

需 planning 期深研的 phase：
- **Phase 4（反思回路）**：复杂、易错（幻觉/自激），需在 plan 期定 grounding 策略与 schema；建议用 Context7 复核 AI SDK v6 反思调用
- **Phase 2（兴趣图谱）**：衰减/novelty 参数需实验调参，属实验性差异化特性

标准模式、可跳过深研的 phase：
- **Phase 1**：索引 sidecar + consolidator 接线，模式清晰
- **Phase 3**：用户画像填充，现有 user-profile.ts 已有结构
- **Phase 5/6**：门控与可观测，模式常规

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | 全复用现有栈；零新增运行时依赖 |
| Features | HIGH | table stakes 有学术+工业共识 |
| Architecture | HIGH | write-manage-read loop 直接骨架 + 第一手代码核查 |
| Pitfalls | HIGH | 多数有 post-mortem + 现存 bug 印证 |

**Overall confidence:** HIGH

### Gaps to Address

- **兴趣衰减/novelty 参数**：需在 Phase 2/6 实验调参，无现成最优值
- **反思 grounding 强度**：Phase 4 plan 期需定"无源丢弃"vs"低支撑降权"的阈值
- **门控阈值初值**：Phase 5 需定初值并靠反馈校准，无先验
- **索引一致性**：双写策略需在 Phase 1 定（saveMemory/deleteMemory 钩子原子更新索引）

## Sources

### Primary (HIGH)
- Generative Agents（Park et al. 2023, arXiv:2304.03442）— memory stream / reflection / 检索三因子 / 计划回写
- MemGPT / Letta（arXiv:2310.08560；letta.com/blog/agent-memory）— 分层记忆、LLM 自管理、self-improve
- "Memory for Autonomous LLM Agents"（arXiv:2603.07670）— write-manage-read loop 分类法（直接印证架构缺口）
- cyber-stray `.planning/codebase/`（ARCHITECTURE/STACK/STRUCTURE/CONCERNS）— 现有结构与现存 bug（第一手）

### Secondary (MEDIUM)
- A-MEM: Agentic Memory（arXiv:2502.12110）；Memo 架构
- Hindsight/Vectorize "Agent Memory Consolidation" — 合并/淘汰四杠杆
- Curiosity-driven exploration（Pathak ICM；DeepMind "Is Curiosity All You Need"）— intrinsic motivation（RL 范式，已适配到 LLM）
- 本地 SQLite 记忆实践（sqlite-memory、memweave）— BM25+向量混合检索

### Tertiary (LOW)
- Self-Evolving-Agents（GitHub）— reflective + memory-augmented 自进化参考

---
*Research completed: 2026-06-20*
*Ready for roadmap: yes*
