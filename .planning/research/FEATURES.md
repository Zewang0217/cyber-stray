# Feature Research

**Domain:** 自进化赛博宠物 — 自主 agent 的长期记忆 / 反思 / 好奇心
**Researched:** 2026-06-20
**Confidence:** HIGH（记忆/反思 table stakes 有学术+工业共识）；差异化特性 MEDIUM（实验性，需在 phase 内验证）

## Feature Landscape

> 用 **write-manage-read loop**（arXiv:2603.07670）作分类骨架：cyber-stray 现有 = write（record_*）+ read（buildMemoryContext），**缺 manage 半边**（反思/合并/遗忘）—— 这正是 table stakes 与差异化的分水岭。

### Table Stakes（用户/学术预期，缺了就不算"会记忆的 agent"）

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **反思：周期性把记忆合成成更高阶洞察** | Generative Agents 的核心贡献；没反思=记了不想 | MEDIUM | LLM 调用，复用 DeepSeek；洞察作为新记忆回写 |
| **相关性检索（recency×importance×relevance）** | Generative Agents 检索三因子；现只有前两个 | MEDIUM | 加 keyword/语义 relevance；需索引层支撑 |
| **有界记忆（合并 + 遗忘）** | 无界记忆拖垮检索与反思；遗忘是特性 | LOW-MEDIUM | consolidator 已写好，只需接线 + 调度 |
| **记忆驱动行为** | 记了要影响下一步；否则只是日志 | MEDIUM | 检索结果 + 进化的兴趣注入 prompt 驱动探索 |

### Differentiators（cyber-stray 的竞争优势，对齐 Core Value）

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **可进化兴趣图谱（反思+反馈双驱动）** | 宠物有"自我"且会成长——这是赛博宠物的灵魂 | HIGH | 替换冻住 agentInterests；权重随反思/点赞变化 |
| **好奇心驱动探索（intrinsic motivation）** | 主动探索"自己感兴趣"的，不只服务主人 | HIGH | novelty(语义/关键词新度)+ 兴趣权重 决定搜索方向 |
| **推送价值门控** | "主动推送主人感兴趣的内容"——内容×用户模型→推 or 只学 | MEDIUM | 替换强制 speak；学习可默认不推 |
| **兴趣可观测性** | 成功标准=兴趣可观测进化；能"看见它成长" | MEDIUM | 导出/日志/Web 展示兴趣图谱演化 |
| **学习 vs 推送解耦** | 探索自己感兴趣的、去学习（不一定推送） | LOW-MEDIUM | 废除空游荡强制 speak 兜底 |

### Anti-Features（看似好、实则坑）

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| 完全自主目标设定 | "让它自己想干啥" | 不可预测、安全难控、易跑偏 | 兴趣图谱驱动探索，但边界可观测可控 |
| 无限保留所有记忆 | "别忘事" | 与自进化相悖；拖垮检索/反思；tokens 爆 | 接 consolidator + 遗忘策略 |
| 完整向量/RAG 检索管线 | "更智能" | 单用户规模过度工程 | BM25/关键词 relevance 先行，向量 defer |
| 多 agent 社会（Generative Agents 小镇） | "更有趣" | scope 爆炸、成本激增 | 单宠物闭环先做扎实 |
| 实时全量反思 | "即时聪明" | 每次游荡都反思→延迟+成本+写放大 | 周期性/批量反思，异步于游荡热路径 |

## Feature Dependencies

```
[反思回路] ──requires──> [记忆索引层]（高效检索/扫描）
    └──writes──> [可进化兴趣图谱]
                     ▲
[反馈强化] ──reinforces──┘
[推送价值门控] ──requires──> [用户兴趣模型] + [可进化兴趣图谱]
[兴趣可观测性] ──requires──> [可进化兴趣图谱]

[废除强制 speak] ──conflicts──> [空游荡强制推送]（必须移除）
```

### Dependency Notes

- **反思 requires 索引层：** 反思要扫描大量原始记忆，O(N) 全文件读会爆；索引层是前置
- **兴趣图谱 requires 反思 + 反馈：** 双驱动写入，单一来源会导致坍缩或僵化
- **推送门控 requires 用户模型 + 兴趣图谱：** 判断"主人是否感兴趣"两边都要
- **废除强制 speak conflicts 现有空游荡兜底：** 必须先移除 `react.ts:209`，否则"学习不推送"不成立

## MVP Definition

### Launch With (v1) — 闭合自进化 loop 的最小集

- [ ] **记忆索引层 + 接线 consolidator** — 否则反思无法高效、记忆无界增长
- [ ] **可进化兴趣图谱** — 替换冻住 agentInterests，loop 的"自我"
- [ ] **反思回路** — manage 半边的核心，合成知识→更新兴趣
- [ ] **用户兴趣模型 + 反馈强化** — 让推送门控有依据
- [ ] **推送价值门控 + 废除强制 speak** — 实现"主动推送主人感兴趣的、学习可不推"
- [ ] **兴趣可观测性** — 让"可观测进化"成功标准可量化

### Add After Validation (v1.x)

- [ ] **语义相关性检索（embedding）** — 触发条件：关键词召回不足
- [ ] **反思质量评分/护栏** — 触发条件：观察到反思幻觉

### Future Consideration (v2+)

- [ ] **多源好奇心（信息增益建模）** — 需要先有稳定兴趣图谱
- [ ] **SQLite 索引迁移** — 触发条件：JSON 索引成瓶颈

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| 反思回路 | HIGH | MEDIUM | P1 |
| 可进化兴趣图谱 | HIGH | HIGH | P1 |
| 记忆索引层 | HIGH（使能器） | MEDIUM | P1 |
| 推送价值门控 | HIGH | MEDIUM | P1 |
| 用户兴趣模型+反馈 | HIGH | MEDIUM | P1 |
| 兴趣可观测性 | MEDIUM（验证用） | MEDIUM | P2 |
| 语义检索 | MEDIUM | MEDIUM | P3 |

## Competitor / Reference Feature Analysis

| Feature | Generative Agents | MemGPT/Letta | cyber-stray 现状 | 我们的方案 |
|---------|-------------------|--------------|------------------|------------|
| 记忆流 | ✓ memory stream | ✓ 分层 memory | ✓ Markdown MemoryStore | 复用 |
| 反思 | ✓ 周期合成洞察 | △ LLM 自编辑 | ✗ 缺 | 新增反思回路 |
| 检索三因子 | ✓ recency×imp×rel | ✓ 分页检索 | △ 仅 recency×imp | 加 relevance + 索引 |
| 遗忘/合并 | △ | ✓ 内存层级淘汰 | ✗ consolidator 死代码 | 接线 |
| 好奇心/兴趣 | △（计划驱动） | ✗ | ✗ agentInterests 冻住 | 兴趣图谱（差异化） |
| 推送门控 | ✗（仿真非推送） | ✗ | ✗ 无门控 | 内容×用户模型（差异化） |

## Sources

- Generative Agents（arXiv:2304.03442）— memory stream / reflection / 检索三因子 / 计划回写（HIGH）
- MemGPT / Letta（arXiv:2310.08560；letta.com/blog/agent-memory, /benchmarking-ai-agent-memory）— 分层记忆、LLM 自管理、self-improve（HIGH）
- A-MEM: Agentic Memory（arXiv:2502.12110）— agentic 自组织记忆（MEDIUM）
- "Memory for Autonomous LLM Agents"（arXiv:2603.07670）— write-manage-read loop 分类法（HIGH）
- Curiosity-driven exploration（Pathak ICM；DeepMind "Is Curiosity All You Need"）— 内在动机/新度驱动探索（MEDIUM，RL 范式，需适配到 LLM）
- Self-Evolving-Agents（github.com/CharlesQ9/Self-Evolving-Agents）— reflective + memory-augmented 自进化（MEDIUM）

---
*Feature research for: 自进化赛博宠物*
*Researched: 2026-06-20*
