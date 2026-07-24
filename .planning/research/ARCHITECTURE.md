# Architecture Research

**Domain:** 自进化赛博宠物 — 把反思回路 + 兴趣图谱 + 索引层 接入现有 cyber-stray ReAct 循环
**Researched:** 2026-06-20
**Confidence:** HIGH（基于第一手代码核查 + Generative Agents/MemGPT 权威范式）

## Standard Architecture

### System Overview — write-manage-read loop（目标态）

```
┌─────────────────────────────────────────────────────────────────┐
│                    WANDER（write + read，已存在）                 │
│  runAgentLoop（react.ts）→ tools: search/read/speak/record_*     │
│  ↑ 读：buildMemoryContext（注入记忆 + 兴趣）  ↓ 写：record_*      │
└──────────────┬───────────────────────────────┬───────────────────┘
               │ read（检索）                   │ write（新记忆）
               ▼                               ▼
┌──────────────────────────────┐   ┌──────────────────────────────┐
│   MEMORY STORE（已有）         │   │   【新】INTEREST GRAPH        │
│  Markdown + frontmatter       │   │  data/interests.json          │
│  + 【新】JSON 索引 sidecar     │   │  带权/来源/lastReinforced      │
│  .index.json {id→meta}        │   │  替换冻住 agentInterests       │
└──────────────┬────────────────┘   └──────────────▲───────────────┘
               │ 读（高效，O(1)查表)                │ 写（反思/反馈）
               ▼                                    │
┌──────────────────────────────────────────────────┴───────────────┐
│            【新】MANAGE 半边（反思 + 合并 + 遗忘）                 │
│  ReflectionEngine（周期 LLM 合成 → 洞察记忆 + 更新兴趣）           │
│  MemoryConsolidator（已有死代码 → 接线：合并/清理/过期）           │
│  异步于游荡热路径，按节奏触发（每 N 次游荡 / 启动时）              │
└──────────────────────────────────────────────────────────────────┘
               │
               ▼  供推送决策
┌──────────────────────────────────────────────────────────────────┐
│        【新】PUSH GATE：内容 × 用户兴趣模型 → 推 or 只学           │
│  替换强制 speak 兜底（react.ts:209）                               │
│  UserProfile（已有，当前空 → 填充 + 反馈强化）                     │
└──────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | 实现位置 |
|-----------|----------------|----------|
| MemoryStore（已有） | Markdown CRUD + 评分注入 | `src/memory/long-term/index.ts`（加索引读写） |
| **MemoryIndex（新）** | JSON sidecar，`{id→{type,ts,importance,tags,keywords,accessedAt}}`，O(1) 查表支撑反思/检索 | 新文件，复用 `readIndex`/`updateIndexAfterSave`（index.ts:81,518） |
| **ReflectionEngine（新）** | 周期性读近期记忆 → LLM 合成洞察 → 回写洞察记忆 + 更新兴趣 | 新 `src/memory/reflection/`；复用 `getProvider()`、`generateText` |
| **InterestGraph（新）** | 替换 `agentInterests`，带权兴趣图谱，驱动探索方向 | 新 `src/memory/interest-graph.ts`；持久化 `data/interests.json` |
| MemoryConsolidator（已有死代码） | 合并同话题 / 清理低价值 / 过期遗忘 | `src/memory/long-term/consolidate.ts` → 接线 + 调度 |
| UserProfile（已有，空） | 主人 likes/dislikes/置信度 | `src/memory/user-profile.ts` → 填充 + 反馈强化 |
| **PushGate（新）** | speak 前判断"主人是否感兴趣" | 接入 `src/tools/registry/speak.ts` 或 react.ts speak 处 |
| ReAct Loop（已有） | 游荡决策；注入进化兴趣 + 检索记忆 | `src/agent/react.ts`、`src/prompts/react.ts` |

## Recommended Project Structure（增量）

```
src/memory/
├── long-term/
│   ├── index.ts            # MemoryStore + 【改】索引读写
│   ├── consolidate.ts      # 【接线】合并/清理/过期
│   ├── memory-index.ts     # 【新】JSON sidecar 索引
│   └── ...
├── reflection/             # 【新】反思回路
│   ├── engine.ts           # 周期反思：合成→洞察→更新兴趣
│   └── scheduler.ts        # 触发节奏（每 N 游荡 / 启动）
├── interest-graph.ts       # 【新】可进化兴趣图谱（替换 agentInterests）
├── push-gate.ts            # 【新】推送价值门控
├── user-profile.ts         # 【改】填充 + 反馈强化
└── feedback-store.ts       # 【改】反馈→画像/兴趣加权
src/agent/
├── react.ts                # 【改】废强制 speak(:209)；注入兴趣；触发反思调度
└── state.ts                # 【改】agentInterests→引用 InterestGraph
src/prompts/
└── react.ts                # 【改】注入进化兴趣 + 检索记忆 + push-gate 指引
data/
├── memory/.index.json      # 【新】记忆索引 sidecar
└── interests.json          # 【新】兴趣图谱持久化
```

### Structure Rationale

- **reflection/ 独立目录：** 反思是新的认知子系统，与存储(MemoryStore)职责分离，便于单独测试与调度
- **interest-graph / push-gate 顶层文件：** 它们是跨记忆/工具的策略组件，不属于 long-term 存储

## Architectural Patterns

### Pattern 1: write-manage-read loop（组织模型）

**What:** 记忆系统 = 写(record) + 管(反思/合并/遗忘) + 读(检索注入)，三段缺一不可
**When to use:** 任何需要"长期记忆驱动行为"的 agent
**Trade-offs:** manage 半边增加 LLM 调用成本，但是自进化的前提
**Example:**
```typescript
// manage：反思周期触发，异步于游荡
async function runReflectionCycle() {
  const recent = await memoryIndex.queryRecent({ type: 'knowledge', since: lastReflection });
  const insights = await reflectionEngine.synthesize(recent);  // LLM 合成
  await saveInsightsAsMemories(insights);                       // write 回去
  await interestGraph.applyReflection(insights);                // 更新兴趣
}
```

### Pattern 2: 索引 sidecar（不改存储、加快速检索）

**What:** Markdown 仍是真相源，旁挂一个 JSON 索引镜像元数据，检索走索引不扫全盘
**When to use:** 文件存储 + 需要频繁检索/全量扫描时
**Trade-offs:** 双写一致性（写 Markdown 时同步更新索引）；可接受，因单进程
**Example:**
```typescript
// saveMemory 后同步更新索引（复用现有 updateIndexAfterSave 钩子）
await memoryIndex.upsert(entry);  // {id,type,timestamp,importance,tags,keywords}
// 检索不再 readdir 每个文件
const hits = await memoryIndex.query({ keywords, type, minImportance });
```

### Pattern 3: 反思只读原始观察、不读旧反思（防自激）

**What:** 反思输入限定为 observation/knowledge/interaction 原始记忆，不把上一轮反思产出当输入
**When to use:** 防止"反思→写反思→再反思"无限抽象
**Trade-offs:** 牺牲部分高阶抽象，换可控性

## Data Flow

### Wander Flow（write+read，改动后）

```
心跳触发 → loadState + InterestGraph → buildReactSystemPrompt（注入进化兴趣+检索记忆）
  → generateText（tools）→ record_knowledge 写新记忆 → 更新 .index.json
  → speak 前 PushGate 判断（内容×UserProfile）→ 推 or 只学
  → 游荡结束 recordWanderSummary
```

### Reflection Flow（manage，新增，异步）

```
每 N 次游荡 / 启动时 → ReflectionEngine 读 .index.json 近期 knowledge/observation
  → LLM 合成洞察（带引用 memoryId）→ 校验(Zod) → 存为新 insight 记忆
  → InterestGraph.applyReflection（增/减/调权）→ 写 data/interests.json
  → Consolidator.consolidateOldMemories + cleanupExpired（有界化）
```

### Feedback Flow（已有，增强）

```
飞书 emoji → feedback-store → UserProfile 更新（已有 30min 冷却）
  → 【新】InterestGraph.applyFeedback（点赞方向加权）
```

### Key Data Flows

1. **兴趣驱动探索：** InterestGraph → buildReactSystemPrompt 注入"当前兴趣(带权)" → 影响 search_web 方向
2. **反思闭合 loop：** 新知识 → 反思 → 洞察 → 兴趣进化 → 下次探索方向变化（"可观测进化"）
3. **推送门控：** 发现内容 → PushGate(内容 × UserProfile × 兴趣) → 推送价值分 → 推 or 静默学习

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 单用户、记忆<1k 条 | JSON 索引 sidecar 足够（本期） |
| 记忆 1k-10k | 索引内存缓存（lazy load）；consolidator 频率调高 |
| 记忆 10k+ / 高频反思 | JSON 索引迁 bun:sqlite；考虑 embedding 语义检索 |

### Scaling Priorities

1. **第一瓶颈：反思全量扫描** → 索引 sidecar（Phase 1）解决
2. **第二瓶颈：记忆无界增长** → 接线 consolidator（Phase 1）解决
3. **第三瓶颈：兴趣坍缩** → novelty 探索项 + 权重衰减（Phase 2/6）

## Anti-Patterns

### Anti-Pattern 1: 反思在游荡热路径同步执行

**What people do:** 每次 wander 内联跑反思
**Why it's wrong:** 反思是 LLM 调用，阻塞游荡、放大成本、写放大
**Do this instead:** 独立周期/异步触发，按节奏（每 N 游荡）

### Anti-Pattern 2: 反思读写同一池导致自激

**What people do:** 反思读"所有记忆"含上一轮反思产出
**Why it's wrong:** 抽象层层叠加，幻觉放大，loop 失控
**Do this instead:** 反思只读原始观察；反思产出标记为独立类型并排除出下次输入

### Anti-Pattern 3: 兴趣只增不减

**What people do:** 兴趣列表只 append
**Why it's wrong:** 坍缩到少数话题；与"可观测进化"相悖（无变化无趣）
**Do this instead:** 权重衰减 + novelty 探索项 + 上限

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| DeepSeek（反思） | 复用 `getProvider()` + `generateText` | 低 temperature；输出 Zod 校验 |
| 飞书/Telegram（推送） | 现有 speak 不变 | 仅在 PushGate 放行时调用 |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| ReflectionEngine ↔ MemoryStore | 经 MemoryIndex 查 + 写洞察记忆 | 不直接扫文件 |
| InterestGraph ↔ react prompt | buildReactSystemPrompt 读图注入 | 图是持久化 JSON，prompt 只读快照 |
| PushGate ↔ speak tool | speak 前调用 gate | gate 失败须显式处理（不静默吞，遵 CLAUDE.md） |

## Sources

- Generative Agents（arXiv:2304.03442）— memory stream / reflection / 检索三因子 / 计划回写（HIGH）
- MemGPT / Letta（arXiv:2310.08560）— 分层记忆、LLM 自管理、self-edit（HIGH）
- "Memory for Autonomous LLM Agents"（arXiv:2603.07670）— write-manage-read loop（HIGH，直接骨架）
- cyber-stray `.planning/codebase/` 映射 — 现有结构与接线点（HIGH，第一手）
- Hindsight/Vectorize "Agent Memory Consolidation" — 合并/淘汰四杠杆（MEDIUM）

---
*Architecture research for: 自进化赛博宠物*
*Researched: 2026-06-20*
