# Phase 1: 记忆基础设施 - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning

<domain>
## Phase Boundary

给记忆系统的 manage 半边打地基，交付四件事（均锁定在 ROADMAP 已定义范围内，不加新能力）：

1. **记忆索引层**（MEM-01）—— 在 Markdown 存储之上加可查询 JSON 索引，让检索/反思不再 O(N) 全文件扫描（消除 `getRecentMemories` 遍历所有类型目录 + `getMemory` 读即写的写放大）
2. **接线 consolidator + cleanup**（MEM-02）—— 接线死代码 `MemoryConsolidator` 与 `cleanupVisitedUrls`，让记忆有界（合并同话题 / 清理低价值 / 过期遗忘）。**本期只接线代码路径 + 单测/手动可跑，不自动触发**（见 D-02）
3. **废除强制 speak**（MEM-03）—— 移除空游荡强制 nonsense speak，让"只学习不推送"成立
4. **修阻塞性 bug**（MEM-04）—— LLM 调用统计接线（反映真实次数）+ 空 catch 显式化（遵 CLAUDE.md 禁止兜底红线）

**不在本期范围**：兴趣图谱（P2）、用户画像（P3）、反思回路（P4）、推送门控（P5）、可观测 UI（P6）、整体迁 SQLite、删旧 Planner 流水线。

</domain>

<decisions>
## Implementation Decisions

### 遗忘策略（MEM-02）

- **D-01（遗忘语义）**：先合并 + 软删除，**非破坏性**。同话题记忆先 `mergeTopicMemories` 合并进摘要；只对"低价值 + 过期"的才软删除（移到 `data/memory/.archive/`，不直接 `rm`）。
  - ⚠ 现状 `mergeTopicMemories`（`consolidate.ts:165`）绕过 store 直接 `writeFile`，**不更新 INDEX**。必须改为走 `MemoryStore.saveMemory`，让索引（含未来 JSON sidecar）一致更新。
- **D-02（触发时机）**：本期只接线代码路径 + 单测/手动可跑，**不自动跑**。定期调度留给 Phase 4 反思周期。
  - ⚠ **此决策放宽了 Phase 1 验收标准 #2**（原："记忆有界：consolidator 周期执行后…`data/memory/` 不再单调无界增长"）。放宽后口径：**"consolidator 已接线且可通过单测/手动调用验证合并、软删除、过期清理逻辑正确"**。planner 须同步更新 ROADMAP Phase 1 验收标准 #2 的措辞（或追加注脚说明定期自动触发属 Phase 4）。用户已明确接受"本期记忆仍可能无界增长直到 Phase 4"。
- **D-03（阈值口径）**：阈值提取进 `data/agent-config.json`（沿用现有"缺失字段回退默认"模式），消除魔法值（现硬编码 7 天 / importance 0.3 / 30 天过期散落在 `consolidate.ts`）。
  - 保守默认：低价值 `importance < 0.2`、过期 `60 天未访问`。先把 loop 跑通不误删，后续可调。
- **D-04（可观测性）**：每次 cleanup **INFO 日志 + 记一条 observation 记忆**双记（如"清理 N 条，话题 X 合并为摘要 Y"），符合 CLAUDE.md 禁止静默数据丢失 + 业务日志规范。数据按 Phase 6 可直接渲染的形状记录（完整 Web/TUI 可视化 UI 属 Phase 6）。

### 空游荡行为（MEM-03）

- **D-05**：废除 `react.ts:223-229` 的空游荡强制 speak（nonsense 兜底推送）。废除本身是需求项，不重新讨论。
- **D-06（空判定扩展）**：空游荡判定从"`spokeTimes===0 && visitedUrls.length>0`"**扩展到"任何 `spokeTimes===0`"**（含没读页面的，即"没逛成"也算空游荡）。
- **D-07（替代行为）**：空游荡**进 STAT 统计但不推送**；数据侧保证按步记录每个节点（搜索 / 阅读 / 记录 / 推文），废除 speak 后不丢粒度。本期不在 TUI/仪表盘做"节点轨迹 UI"（见 Deferred）。

### 工具错误处理（MEM-04 + CLAUDE.md 禁止兜底）

- **D-08（ReAct 工具失败）**：错误作为 **tool result 回喂 LLM 自恢复**（AI SDK 原生模式——工具 execute 抛错时 SDK 把结构化错误返回模型，由 LLM 决定重试/换路/停止）。这是错误传播，不是兜底掩盖，符合红线。
- **D-09（底层存储 catch）**：`getMemory`/`deleteMemory`/`readIndex` 现状把"未找到"和"读取/解析失败"混为一谈（统一返 null/false/默认）。**改为区分**：`not found` 返 null（合法空值）；读取/解析失败**抛错**（不兜底）。调用方可区分"没有"与"坏了"。
- **D-10（generateText 整体失败）**：记 **ERROR + 重试 N 次**，仍失败再结束本轮游荡。N 的具体值交 planner/researcher（默认建议 1-2 次，避免长延迟/成本）。
- **D-11（LLM 统计计数）**：改用 **AI SDK v6 `onStep`/`onFinish` 回调按步计数**，修复现状"只包整次 `generateText` → calls 恒为 1"的失真。`onStep` 具体 API 交 researcher 用 Context7 核对 AI SDK v6 当前语法。

### Claude's Discretion

- **记忆索引形态**（用户未选讨论，按项目已锁定方向定默认）：JSON sidecar（`data/memory/.index.json`）与现有 `INDEX.md` **双写共存**，保留 INDEX.md 人类可读性（PROJECT.md Key Decision）；JSON 索引替代 `getRecentMemories`/`searchMemories` 的全扫；`getMemory` 读即写问题随索引层一并处理（accessedAt 迁到索引、不再每次读重写文件）。索引 schema、原子双写、崩溃一致性细节交 researcher/planner。
- 重试次数 N、`onStep` 具体 API、`.archive/` 目录结构与保留期、索引 schema → researcher/planner 定。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 架构与研究
- `.planning/research/SUMMARY.md` — write-manage-read loop 架构；Phase 1 对应 manage 半边的"地基"（索引 + consolidator），reflection 半边属 Phase 4
- `.planning/REQUIREMENTS.md` — MEM-01/02/03/04 的权威定义与验收口径
- `.planning/PROJECT.md` §Key Decisions / §Constraints — Markdown + JSON 索引 sidecar 锁定、禁止兜底、不整体迁 SQLite、统一游荡+推送门控

### 行为规范（红线）
- `CLAUDE.md`（项目根）§Code Quality —— 错误显式处理、不允许 silent fail / 空 catch
- `~/.claude/CLAUDE.md` §禁止随意使用兜底 —— 错误该报错，不用默认值/降级掩盖（D-08/D-09 的依据）

### 代码（改动落点）
- `src/memory/long-term/index.ts` — `MemoryStore`：`getRecentMemories` 全扫（:282）、`getMemory` 读即写（:257）、`saveMemory`→`updateIndexAfterSave` 钩子点（:519）、`deleteMemory`（:330）/`readIndex`（:62）的 catch
- `src/memory/long-term/consolidate.ts` — `MemoryConsolidator`（零调用点死代码）；`mergeTopicMemories`（:165，绕过 store 须修）
- `src/tools/dedup/url-tracker.ts:179` — `cleanupVisitedUrls`（零调用点，待接线）
- `src/agent/react.ts` — 强制 speak（:223）、LLM stats 包整次 `generateText`（:182/199）、STAT 日志块（:206）、`generateText` catch（:195）
- `src/llm/stats.ts` — `startLLMCall`/`endLLMCall`（模块级状态，D-11 改造对象）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `MemoryStore.updateIndexAfterSave`（index.ts:519）—— 索引双写的现成钩子点，JSON sidecar 更新挂这里
- `MemoryConsolidator`（consolidate.ts）—— `consolidateOldMemories` / `cleanupExpired` / `mergeTopicMemories` / `getFileCounts` 已实现，只需接线 + 改 merge 走 store + 软删除
- `getMemoryConsolidator()` / `getMemoryStore()` —— 模块级单例已就绪
- `ctx.wanderHistory`（react.ts）—— 已按步累积节点数据，空游荡统计可直接复用
- STAT 日志块（react.ts:206）—— 已汇总 steps/search/read/speak，空游荡计数并入即可

### Established Patterns
- 模块级单例主导状态共享（getMemoryStore/getMemoryConsolidator/getProvider）
- `config` 冻结于 import；`data/agent-config.json` 缺失字段回退默认（D-03 阈值走此模式）
- 工具经 `ToolManager.getTools(ctx)` 包装为 AI SDK tool，execute 抛错可被 SDK 回喂 LLM（支撑 D-08）
- 现有索引 `INDEX.md` 走 Markdown 解析/格式化；JSON sidecar 是**新增并行层**，不改 Markdown 真相源

### Integration Points
- `saveMemory`/`deleteMemory` → JSON 索引双写钩子
- Agent 启动 `src/index.ts` → consolidator 接线点（本期代码可达但不自动跑）
- `react.ts` 游荡结束 → 空游荡统计 + 废除 speak 兜底
- AI SDK `generateText` `onStep` 回调 → stats 按步计数

</code_context>

<specifics>
## Specific Ideas

- **用户原话（空游荡愿景）**："TUI 和仪表盘我希望能记录每一次游荡每一个节点干了什么——搜索? 学习? 记录? 推文?——用户可自行观察宠物"。→ 本期数据侧保证按步记录不丢粒度，节点轨迹 UI 留 Phase 6。
- **遗忘是非破坏的**：合并优先 + 软删除，符合"遗忘是特性不是 bug"，但不可逆数据丢失要避免（用户明确选了"先合并 + 软删除"而非直接 rm）。

</specifics>

<deferred>
## Deferred Ideas

- **游荡节点轨迹 TUI/仪表盘 UI** —— 完整的可视化（每步节点展示）属 Phase 6（OBS）。本期只保证数据被按步记录。
- **consolidator 定期/启动自动调度** —— Phase 4 反思周期接管。本期只接线 + 手动可跑（见 D-02，已据此放宽验收标准 #2）。
- **删除死的旧 Planner→Decision→Actions 流水线**（`planner.ts`/`actions.ts`/`filter/*`/`content/generator.ts`/`decision.ts`）—— PROJECT.md 列为可选技术债，非自进化核心主线，本期不纳入。
- **JSON 索引迁 `bun:sqlite`** —— v2，仅当 JSON 索引吃力时（REQUIREMENTS §v2 SRCH-02）。

</deferred>

---

*Phase: 1-记忆基础设施*
*Context gathered: 2026-06-20*
