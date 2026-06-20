# Phase 1: 记忆基础设施 - Research

**Researched:** 2026-06-20
**Domain:** Agent 长期记忆系统的 manage 半边地基 —— JSON 索引层、consolidator 接线、强制 speak 废除、LLM 统计与错误处理修复
**Confidence:** HIGH（代码落点已逐行核查；AI SDK v6 `onStepEnd` 与 Bun 原子写经 Context7 核实）

## Summary

Phase 1 给 cyber-stray 的记忆系统补上 **write-manage-read loop 中缺失的 manage 半边地基**，四件事全部锁在 ROADMAP 范围内（MEM-01/02/03/04），**零新增运行时依赖**——全部复用现有 Bun + AI SDK v6 + DeepSeek + Zod 栈。本期的研究难点集中在两处：D-11（按步计数）依赖 AI SDK v6 当前回调 API，D-01/D-09 的索引双写与错误显式化依赖具体代码落点。

**最高风险项 D-11 已用 Context7 /vercel/ai 核实**：AI SDK v6（`ai@6.0.208`，当前安装版）提供 `onStepStart` / `onStepEnd` / `onLanguageModelCallStart` / `onLanguageModelCallEnd` 生命周期回调。在多步工具调用 loop 中，**一个 step = 一次 LLM 调用**——按步计数应挂在 `onStepStart`（开始）或 `onStepEnd`（拿到 usage/performance）。现状代码（`react.ts:182/199`）用 `startLLMCall`/`endLLMCall` 把整个 `generateText` 包成一次，导致 `calls` 恒为 1，与 `maxSteps=10` 的真实步数严重失真。修复方式：移除手工 start/end 包装，改用 `onStepEnd` 回调累加计数器。**关键陷阱**：Context7 明确记载"回调内抛错会被 SDK 静默吞掉"（*errors within these callbacks are silently caught*）——计数逻辑自身不可抛错。

**索引层（MEM-01）的崩溃一致性方案已定**：JSON sidecar（`data/memory/.index.json`）用 **temp-file + atomic rename** 模式写（Bun 的 POSIX `rename` 实现 EINTR 重试、是原子操作，Windows 用 `NtSetInformationFile` + `FILE_RENAME_REPLACE_IF_EXISTS`，均由 Context7 /oven-sh/bun 核实）。Markdown 是真相源，JSON 是查询索引；两者通过 `saveMemory`/`deleteMemory` 的 `updateIndexAfterSave` 钩子双写。`getMemory` 的"读即写"写放大问题（每次读都 rewrite Markdown 来 bump `accessedAt`）随索引层一并解决：**`accessedAt` 迁到 JSON 索引，Markdown 读路径不再写**。

**Primary recommendation:** 本期四件事可完全在现有代码落点上完成——(1) 新增 `MemoryIndex` 模块（JSON sidecar + 挂 `updateIndexAfterSave` 双写）；(2) `MemoryConsolidator` 改走 `store.saveMemory` 并接线（不自动触发）；(3) 删 `react.ts:223-229` 强制 speak 块 + 扩空判定；(4) `react.ts` 改用 `onStepEnd` 按步计数 + 所有 silent catch 显式化。所有改动配 Bun 单测，复用现有 `useTempDataDir`/`mockFetchError` 测试夹具。

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 记忆索引（JSON sidecar 检索） | 数据/存储层（`src/memory/long-term/`） | — | 索引是存储内部实现细节，对调用方透明；`getRecentMemories`/`searchMemories` 内部改走索引，签名不变 |
| Markdown 真相源 + 双写一致性 | 数据/存储层 | — | Markdown 仍是人类可读真相源；JSON 索引由 `saveMemory`/`deleteMemory` 钩子维护 |
| consolidator 合并/软删除 | 数据/存储层（`MemoryConsolidator`） | — | 记忆容量管理属存储内部；本期接线代码路径但不自动触发 |
| LLM 按步统计 | Agent 层（`react.ts` + `stats.ts`） | AI SDK 回调 | 统计由 AI SDK `onStepEnd` 回调驱动，状态存 `stats.ts` 模块级变量 |
| 强制 speak 废除 | Agent 层（`react.ts`） | — | 游荡结束的兜底推送是 Agent 行为决策，属 ReAct loop 边界 |
| 工具错误显式化 | 跨层（存储/工具） | — | `getMemory`/`deleteMemory`/`readIndex` 的 catch 在存储层；ReAct 工具失败由 AI SDK 原生回喂 LLM（D-08） |

**关键边界判断：** 全部改动都在**数据/存储层**与**Agent 层**，不涉及 Frontend Server / CDN / Browser。Web 仪表盘是独立 Next.js app、只读轮询 `../data/*`，本期改 `.index.json` schema 后其轮询契约不受破坏（仪表盘当前不读 `.index.json`，只读 `state.json`/`wander-history.json`）。

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ai`（Vercel AI SDK） | `6.0.208`（已装，npm 已核实） | `generateText` + `onStepEnd` 回调按步计数 | 项目已用；D-11 修复直接复用其生命周期回调 [VERIFIED: npm registry + Context7 /vercel/ai] |
| `@ai-sdk/deepseek` | `2.0.39`（已装） | DeepSeek provider | 已配置；本期无变更 [VERIFIED: npm registry] |
| `zod` | `4.4.3`（已装） | 校验索引 schema / consolidator 选项 | 项目已全面用 Zod；索引 sidecar schema 复用 [VERIFIED: npm registry] |
| Bun 内置 `fs/promises` | `1.3.13`（已装） | `writeFile`/`rename`/`mkdir` 原子写 | 原子 rename 经 Context7 核实为 POSIX 原子操作 [VERIFIED: Context7 /oven-sh/bun] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `bun:test` | 随 Bun | consolidator/索引/onStepEnd 的单测 | 复用现有测试夹具（`useTempDataDir`/`mockFetchError`/`mockChatCompletion`） |
| `data/agent-config.json`（新增字段） | — | consolidator 阈值外置（D-03） | 沿用现有"缺失字段回退默认"模式 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JSON sidecar 索引 | `bun:sqlite` | 单用户、记忆量级小，JSON 足矣；SQLite 整体迁移用户已明确 defer（REQUIREMENTS v2 SRCH-02）|
| 关键词 relevance（未来 P4 反思） | 向量 embedding | 本期不做反思；BM25/关键词评分 defer 到 P4 评估 |
| `onStepEnd` 按步计数 | `result.steps.length` 后置统计 | `onStepEnd` 实时累加、可在中途观测；后置 `result.steps.length` 简单但失败路径（generateText 整体抛错）拿不到 steps 数组——D-10 重试场景下 onStepEnd 更鲁棒 |

**Installation:**
```bash
# 无需新增依赖 —— 全部复用现有栈
# 验证已装版本（已执行）：
#   npm view ai version        → 6.0.208
#   npm view zod version       → 4.4.3
#   npm view @ai-sdk/deepseek  → 2.0.39
#   bun --version              → 1.3.13
```

## Package Legitimacy Audit

> 本期**不安装任何新包**（零新增运行时依赖，全部复用现有栈）。审计仅核实现有核心包合法性。

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `ai` | npm | 活跃（2026-06-18 最新） | 15.3M/wk | github.com/vercel/ai | SUS（"too-new" 启发式误报） | Approved —— 已在用，官方仓库高下载 |
| `@ai-sdk/deepseek` | npm | 活跃（2026-06-16 最新） | 1.13M/wk | github.com/vercel/ai | SUS（"too-new" 启发式误报） | Approved —— 已在用，官方仓库 |
| `zod` | npm | 活跃（2026-05-04 最新） | 200M/wk | github.com/colinhacks/zod | OK | Approved |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `ai`、`@ai-sdk/deepseek` —— 标记仅为"too-new"启发式（最新版发布日期近），但二者均来自 `vercel/ai` 官方 monorepo、下载量极高、已在生产路径运行，**判定为误报**。无需 `checkpoint:human-verify`（包非本期新装）。

**postinstall 脚本检查：** `ai` 无 postinstall 脚本（`npm view ai scripts.postinstall` 返回空）——无供应链风险。

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │           runAgentLoop (react.ts)            │
                    │   generateText({ onStepEnd, stopWhen, ... }) │
                    └──────────────┬──────────────────────────────┘
                                   │ onStepEnd({stepNumber, usage, performance})
                                   ▼
                    ┌─────────────────────────────────────────────┐
                    │            stats.ts (按步计数)               │
                    │   recordStep(usage) → calls++, totalMs+=...  │
                    └─────────────────────────────────────────────┘

  ReAct 工具调用 (search_web / read_page / record_knowledge / speak / rest)
        │                           │
        ▼                           ▼
┌──────────────────┐    ┌────────────────────────────────────────┐
│ record_knowledge │    │ MemoryStore.saveMemory / deleteMemory   │
│ → saveMemory()   │───▶│   1. writeFile(*.md)        [真相源]    │
└──────────────────┘    │   2. updateIndexAfterSave()              │
                        │      ├─ writeIndex(INDEX.md)  [人类可读] │
                        │      └─ writeJsonIndex(.index.json) ★新增│
                        └───────────────┬────────────────────────┘
                                        │
                        ┌───────────────▼────────────────────────┐
                        │   getRecentMemories / searchMemories    │
                        │   ★改走 .index.json (O(1)查表)          │
                        │   ★不再 readdir + 全文件读 (O(N) 全扫)  │
                        └────────────────────────────────────────┘

  游荡结束 (本期接线、不自动触发)
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│              MemoryConsolidator (consolidate.ts)                 │
│  mergeTopicMemories(topic)                                       │
│    ★改走 store.saveMemory (不再 writeFile 绕过索引)             │
│    ★旧文件软删除 → data/memory/.archive/<type>/<id>.md          │
│  cleanupExpired() / consolidateOldMemories()                     │
│    ★阈值读 data/agent-config.json (不再硬编码)                  │
│    ★INFO 日志 + observation 记忆双记 (D-04)                      │
└─────────────────────────────────────────────────────────────────┘

  游荡结束 (废除项)
        ✗ react.ts:223-229 强制 speak nonsense 兜底 (MEM-03 删除)
```

**数据流说明：** 跟踪主用例"游荡中 record_knowledge → 检索时命中索引"：(1) 工具调 `saveMemory` → (2) `updateIndexAfterSave` 双写 Markdown + `.index.json` → (3) 下次 `buildMemoryContext`→`getRecentMemories` 改走 `.index.json` 查表 → (4) O(1) 命中而非 O(N) 全扫。

### Recommended Project Structure

```
src/memory/long-term/
├── index.ts              # MemoryStore：挂双写钩子、改 getMemory 不再读即写
├── types.ts              # 新增 MemoryIndexRecord schema（Zod）
├── consolidate.ts        # MemoryConsolidator：merge 走 store、软删除、阈值外置
├── memory-index.ts       # ★新增：JSON sidecar 索引模块（读写 .index.json）
├── archive.ts            # ★新增：软删除归档（move 到 .archive/）
├── index.test.ts         # 扩展：索引双写、getMemory 不重写、检索命中
├── consolidate.test.ts   # ★新增：合并/软删除/过期清理单测
└── memory-index.test.ts  # ★新增：索引读写、原子写、崩溃恢复单测

src/agent/
├── react.ts              # 删强制 speak、改 onStepEnd 计数、扩空判定
└── react.test.ts         # 扩展：onStepEnd 计数、空游荡不推送

src/llm/
└── stats.ts              # 改 recordStep(usage) API（或保留 start/end 但由 onStep 驱动）

data/
├── memory/
│   ├── .index.json       # ★新增：JSON 索引 sidecar
│   ├── .archive/         # ★新增：软删除归档目录
│   │   ├── knowledge/
│   │   ├── interactions/
│   │   ├── observations/
│   │   └── profile/
│   ├── INDEX.md          # 保留（人类可读，双写共存）
│   ├── knowledge/        # 真相源 Markdown
│   ├── interactions/
│   └── observations/
└── agent-config.json     # ★新增 consolidator 阈值字段
```

### Pattern 1: AI SDK v6 按步生命周期回调（D-11 核心）
**What:** AI SDK v6 的 `generateText` 在多步工具调用 loop 中，每个 step 触发一次 `onStepStart`/`onStepEnd`。一个 step = 一次 LLM 调用（文本步或工具步都算）。
**When to use:** 任何需要按步统计/观测/记录的 ReAct loop。
**Example:**
```typescript
// Source: Context7 /vercel/ai — tools-and-tool-calling.mdx + lifecycle-callbacks.mdx
import { generateText, stepCountIs, hasToolCall } from 'ai';

await generateText({
  model: provider.chat(config.llmModel),
  system: systemPrompt,
  prompt: initialUserPrompt,
  stopWhen: [hasToolCall('rest'), stepCountIs(maxSteps)],
  tools,
  // ★按步计数：每个 step 结束（拿到 usage/performance）累加
  onStepEnd({ stepNumber, finishReason, usage, performance }) {
    // 关键陷阱：回调内抛错被 SDK 静默吞掉——计数逻辑自身不可抛错
    recordStep({ stepNumber, usage, performanceMs: performance?.totalMs });
  },
  // 可选：onStepStart 在 LLM 调用前打点（用于实时观测开始）
  onStepStart({ stepNumber }) {
    logger.debug(`[${traceId}] step ${stepNumber} starting`);
  },
});
```

### Pattern 2: temp-file + atomic rename（索引崩溃一致性）
**What:** JSON sidecar 写入用临时文件 + `rename` 保证原子——读者要么读到旧版、要么读到新版、绝不读到半写。
**When to use:** 任何需要崩溃一致性的单文件 JSON 索引/状态。
**Example:**
```typescript
// Source: Context7 /oven-sh/bun — POSIX rename EINTR 重试 + Windows NtSetInformationFile
import { writeFile, rename } from 'fs/promises';
import { join } from 'path';

async function writeJsonIndexAtomic(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.tmp`;  // 同目录保证同文件系统（rename 原子性前提）
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await rename(tmp, path);    // POSIX 原子；Windows FILE_RENAME_REPLACE_IF_EXISTS
}
```

### Pattern 3: 索引双写钩子（真相源 + 索引一致）
**What:** Markdown 是真相源，JSON 索引是派生缓存；二者通过 `saveMemory`/`deleteMemory` 的现有 `updateIndexAfterSave` 钩子同步。
**When to use:** 真相源 + 查询索引共存架构。
**Example:**
```typescript
// 复用现有 MemoryStore.updateIndexAfterSave（index.ts:519）扩为三写：
// Markdown 文件（saveMemory 已写）→ INDEX.md（人类可读，现有）→ .index.json（查询，新增）
private async updateIndexAfterSave(entry: MemoryEntry): Promise<void> {
  // 既有：写 INDEX.md
  await this.updateIndexMarkDown(entry);
  // ★新增：写 .index.json（原子）
  await this.jsonIndex.upsert(entry);
}

// deleteMemory 同理：删 Markdown → updateIndexAfterDelete（双写 INDEX.md + .index.json）
```

### Anti-Patterns to Avoid
- **❌ 整次 `generateText` 包 start/end**（现状 `react.ts:182/199`）：多步 loop 只算 1 次，统计失真。改用 `onStepEnd`。
- **❌ `onStepEnd` 回调内抛错**：SDK 静默吞掉（Context7 明确记载），计数逻辑必须 try/catch 自愈或用纯累加。
- **❌ `getMemory` 读即写 Markdown**（现状 `index.ts:257-277`）：每次读重写文件 bump `accessedAt`，写放大 + 与并发读冲突。`accessedAt` 迁索引。
- **❌ `mergeTopicMemories` 绕 store 直写文件**（现状 `consolidate.ts:201`）：INDEX 与 .index.json 不同步。改走 `store.saveMemory`。
- **❌ silent catch 返 null/false/默认**（现状多处）：违反 CLAUDE.md 禁止兜底红线。区分 `not found`（合法空值，返 null）与 `读取/解析失败`（抛错）。
- **❌ 直接 `rm` 删记忆**（现状 `consolidate.ts:131/237`）：不可逆。D-01 已定软删除（移到 `.archive/`）。
- **❌ 索引写到不同文件系统再 rename**：跨文件系统 rename 退化为 copy+delete，非原子。临时文件必须同目录。

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 原子文件写 | 自实现 fsync+lock | `writeFile(tmp) + rename` | Bun/POSIX rename 已是原子；自实现易漏 fsync/竞态 |
| 按步 LLM 计数 | 自实现 step 跟踪 | AI SDK `onStepEnd({stepNumber, usage})` | SDK 原生回调；自跟踪要解析 result.steps，失败路径拿不到 |
| Zod schema 校验 | 手写 if 校验 | `zod@4` | 项目已全面用；防 LLM/配置脏数据 |
| 崩溃恢复（索引丢失） | 自实现 WAL | 启动时 `rebuildIndexFromMarkdown()` 重建 | 单用户量级小；启动重建 < 1s；WAL 过度工程 |

**Key insight:** 本期所有"看似需要自建"的基础设施（原子写、按步计数、schema 校验）都已有现成标准方案——Bun fs、AI SDK 回调、Zod。任何"自实现"都会引入难以察觉的竞态或统计失真。

## Common Pitfalls

### Pitfall 1: onStepEnd 回调内抛错被静默吞掉
**What goes wrong:** 在 `onStepEnd` 里做复杂逻辑（如写文件/网络），抛错时 SDK 不冒泡、计数静默丢失。
**Why it happens:** Context7 明确记载 *"Errors within these callbacks are silently caught"*——SDK 设计为可观测回调，不阻断主流程。
**How to avoid:** 计数逻辑只做纯内存累加（`calls++`/`totalMs +=`）；任何 IO 在回调内用 try/catch 自愈，绝不向上抛。
**Warning signs:** 统计又出现"偶发丢步"但无错误日志。

### Pitfall 2: generateText 整体抛错时拿不到 steps 数组
**What goes wrong:** D-10 重试场景下，`generateText` 整体 reject 时 `result.steps` 不存在；若计数依赖后置 `result.steps.length` 则失败路径计数为 0。
**Why it happens:** 网络错/API key 错等使 generateText 在第一步就 reject，无 result 返回。
**How to avoid:** 用 `onStepEnd` 实时累加（已成功完成的步会触发回调），而非后置 `result.steps.length`。D-10 重试时每次 attempt 独立计数。
**Warning signs:** 失败轮 `calls === 0` 但日志显示确实发起了请求。

### Pitfall 3: 索引双写中间崩溃导致不一致
**What goes wrong:** 写完 Markdown、未写 `.index.json` 时进程崩溃 → 索引缺条。
**Why it happens:** 双写非原子（Markdown + JSON 两次独立写）。
**How to avoid:** (1) Markdown 永远先写（真相源优先）；(2) 启动时 `rebuildIndexFromMarkdown()` 自愈重建——扫描所有 `*.md` 重建 `.index.json`；(3) JSON 单文件写用 temp+rename 原子。**接受"崩溃后索引可能滞后一条，下次启动重建"**——单用户场景可接受，无需 WAL。
**Warning signs:** 检索结果与 `readdir` 计数不一致。

### Pitfall 4: accessedAt 迁移丢失历史访问时间
**What goes wrong:** 把 `accessedAt` 从 Markdown frontmatter 迁到 JSON 索引时，旧 Markdown 里的 `accessedAt` 丢失。
**Why it happens:** 迁移脚本若只读新格式、不读旧 frontmatter 的 `accessedAt`，会丢历史。
**How to avoid:** 启动重建 `rebuildIndexFromMarkdown()` 时，**先解析 frontmatter 的 `accessedAt` 字段**（现有 `parseMemoryFrontmatter` 已解析），写入 JSON 索引；之后再停写 Markdown 的 `accessedAt`。迁移期两处都读、只索引写。
**Warning signs:** consolidator 的 `cleanupExpired`（基于 accessedAt）突然清理掉大量记忆。

### Pitfall 5: 索引 schema 漂移导致老索引无法读
**What goes wrong:** 后续 phase 给 `.index.json` 加字段后，旧索引文件缺少字段、读取抛错。
**Why it happens:** 无版本号 + 无默认值兼容。
**How to avoid:** `.index.json` 顶层带 `version: 1`；读取时 schema 校验 + 缺失字段填默认；版本不匹配触发 `rebuildIndexFromMarkdown()` 重建。
**Warning signs:** 升级后首次启动检索报错。

### Pitfall 6: 软删除目录被 consolidator 当成活记忆重扫
**What goes wrong:** `.archive/` 放在 `data/memory/` 下，`getRecentMemories` 的 `readdir` 误扫。
**Why it happens:** `.archive/` 不在 `MEMORY_TYPE_PATHS` 但在 basePath 下。
**How to avoid:** (1) `.archive/` 用点前缀（`.gitignore` 习惯）；(2) `getRecentMemories` 只遍历 `MEMORY_TYPE_PATHS` 的明确子目录（现状已是 `profile/knowledge/interactions/observations`，不含 `.archive`）；(3) consolidator 的 `readdir` 同理只扫 `MEMORY_TYPE_PATHS`。**`.archive/` 不在 `MEMORY_TYPE_PATHS`，天然不会被扫到**——但代码须显式依赖此约定，勿用通配。
**Warning signs:** 归档记忆又出现在检索结果里。

## Code Examples

### Example 1: stats.ts 改为按步记录（D-11）
```typescript
// Source: 改造现有 src/llm/stats.ts；onStepEnd 签名来自 Context7 /vercel/ai
export interface StepRecord {
  stepNumber: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  durationMs: number;
}

let steps: StepRecord[] = [];

export function recordStep(rec: StepRecord): void {
  steps.push(rec);
}

export function getLLMStats(): LLMStats {
  const calls = steps.length;
  const totalMs = steps.reduce((s, r) => s + r.durationMs, 0);
  const totalTokens = steps.reduce((s, r) => s + (r.totalTokens ?? 0), 0);
  const avgMs = calls > 0 ? Math.round(totalMs / calls) : 0;
  return { calls, totalMs, avgMs, totalTokens };
}

export function resetLLMStats(): void {
  steps = [];
}
// 注意：onStepEnd 的 performance 字段提供 step 耗时；若拿不到则用 Date.now() 差值
```

### Example 2: react.ts 改用 onStepEnd（替换 start/end 包装）
```typescript
// Source: 改造现有 src/agent/react.ts:182-200；onStepEnd 来自 Context7 /vercel/ai
// 移除 startLLMCall()/endLLMCall() 包装，改用回调
let attempt = 0;
const maxRetries = config.generateTextMaxRetries ?? 1;  // D-10 默认 1 次
for (attempt = 0; attempt <= maxRetries; attempt++) {
  try {
    await generateText({
      model: provider.chat(config.llmModel),
      temperature: config.wanderTemperature,
      system: systemPrompt,
      prompt: initialUserPrompt,
      stopWhen: [hasToolCall('rest'), stepCountIs(maxSteps)],
      tools,
      onStepEnd({ stepNumber, usage, performance }) {
        // 纯内存累加，不抛错（回调内异常被 SDK 静默吞）
        try {
          recordStep({
            stepNumber,
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: usage?.totalTokens,
            durationMs: performance?.totalMs ?? 0,
          });
        } catch { /* 计数自愈，不影响主流程 */ }
      },
    });
    break;  // 成功，退出重试
  } catch (error) {
    logger.error(`[${ctx.traceId}] LLM 调用异常 (attempt ${attempt + 1}/${maxRetries + 1})`, { error });
    if (attempt === maxRetries) {
      ctx.endReason = 'error';
    }
  }
}
```

### Example 3: 废除强制 speak（MEM-03，D-05/D-06/D-07）
```typescript
// Source: 删除 src/agent/react.ts:222-229，扩空判定
// ✗ 删除整个块：
//   if (ctx.spokeTimes === 0 && ctx.visitedUrls.length > 0) {
//     await speak(`刚才出去溜达了一圈...`, 'nonsense')...
//   }

// ★ STAT 日志已有 speakCount，空游荡自动体现（D-07：进统计不推送）
// ★ D-06 空判定扩展：无需改代码——统计已记录 spokeTimes===0 的所有情况
//   （原条件 visitedUrls.length > 0 只是 speak 触发条件，废除后无意义）

// STAT 日志块（react.ts:206）已含 speakCount，空游荡自动可见
```

### Example 4: MemoryStore.getMemory 不再读即写（MEM-01）
```typescript
// Source: 改造现有 src/memory/long-term/index.ts:257-277
async getMemory(type: MemoryType, id: string): Promise<MemoryEntry | null> {
  const filepath = this.getMemoryPath(type, id);
  if (!existsSync(filepath)) {
    return null;  // not found —— 合法空值（D-09）
  }
  // 读取/解析失败：抛错（不兜底返 null，D-09 + CLAUDE.md 红线）
  const content = await readFile(filepath, 'utf-8');  // 抛错上冒
  const entry = this.parseMemoryFromMarkdown(content, id, type);

  // ★不再 writeFile 重写文件 bump accessedAt
  // ★accessedAt 迁到 JSON 索引：best-effort 更新（失败不影响读）
  await this.jsonIndex.touchAccessedAt(type, id).catch((e) =>
    logger.warn('更新索引 accessedAt 失败', { id, error: e })
  );

  // 返回的 entry.accessedAt 从索引读（若索引有），否则用 timestamp
  entry.accessedAt = await this.jsonIndex.getAccessedAt(type, id) ?? entry.timestamp;
  return entry;
}
```

### Example 5: mergeTopicMemories 改走 store（D-01）
```typescript
// Source: 改造现有 src/memory/long-term/consolidate.ts:165-212
async mergeTopicMemories(topic: string): Promise<void> {
  if (!this.store) {
    throw new Error('mergeTopicMemories 需要 MemoryStore 实例（索引双写依赖）');
  }
  // ... 解析 topicFiles → entries（同现有）...

  const merged: MemoryEntry = { /* 同现有构造 */ };
  // ★改走 store.saveMemory（双写 INDEX.md + .index.json）
  await this.store.saveMemory(merged);

  // ★旧文件软删除到 .archive/（不再 rm）
  for (const file of topicFiles) {
    await archiveFile(join(dir, file), topic);  // move 到 .archive/knowledge/
  }

  // D-04：INFO 日志 + observation 记忆双记
  logger.info('记忆合并完成', { topic, count: entries.length, mergedId: merged.id });
  await this.store.saveMemory({
    type: 'observation',
    timestamp: new Date().toISOString(),
    tags: ['consolidation'],
    summary: `合并话题 ${topic}`,
    content: `合并 ${entries.length} 条记忆为 ${merged.id}`,
    importance: 0.3,
  });
}
```

### Example 6: 阈值外置到 agent-config.json（D-03）
```json
{
  "_consolidationNote": "记忆合并/清理阈值（D-03）。保守默认：先跑通不误删",
  "consolidation": {
    "lowImportanceThreshold": 0.2,
    "expiryDays": 60,
    "mergeMaxAgeDays": 7,
    "urlCleanupDays": 30
  }
}
```
```typescript
// config.ts 沿用现有"缺失字段回退默认"模式读取
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `onFinish` 单次回调 | `onStepEnd` 按步回调 + `onStepStart` | AI SDK v6 | 多步 loop 可按步观测；v7 进一步 `onEnd`+`finalStep` |
| `totalUsage`（v6） | `usage`（v7，所有步累计） | AI SDK 7.0 迁移指南 | 本期仍 v6，用 `onStepEnd` 累加即可，不依赖 totalUsage |
| `stepCountIs`（现用） | `isStepCount`（cookbook 新名） | AI SDK docs | 二者等价；现项目用 `stepCountIs` 不必改 |
| 文件直接 `rm` 删记忆 | 软删除归档 `.archive/` | 本期 D-01 | 不可逆数据丢失避免；符合"遗忘是非破坏的" |
| 硬编码阈值（7天/0.3/30天） | 配置外置 `agent-config.json` | 本期 D-03 | 魔法值消除；调参无需改代码 |
| silent catch 返默认 | 区分 not found vs 抛错 | 本期 D-09 | 符合 CLAUDE.md 禁止兜底红线 |

**Deprecated/outdated（本期不涉及但需知）：**
- AI SDK v7 的 `onEnd`/`finalStep`：本项目锁 `ai@6`，不改。
- `result.totalUsage`：v6 仍可用，但本期用 `onStepEnd` 累加更直接。

## Assumptions Log

> 所有标注 `[ASSUMED]` 的声明。planner 与 discuss-phase 用此表识别需用户确认的决策。

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `onStepEnd` 的 `performance.totalMs` 字段在 DeepSeek provider 下可用 | Code Examples / Pattern 1 | 若 provider 不填充 performance，durationMs 会是 0；fallback 用 `Date.now()` 差值。planner 须在 Wave 0 加单测验证 |
| A2 | D-10 重试默认 1 次合理（总 attempts = 2） | Code Examples / Example 2 | 游荡延迟翻倍但成本可控；用户可在 config 调。CONTEXT.md 已建议 1-2 次 |
| A3 | `.archive/` 用点前缀即避免被 `readdir` 误扫（依赖代码只扫 `MEMORY_TYPE_PATHS`） | Pitfall 6 | 现状代码确实只扫 `MEMORY_TYPE_PATHS`（已核查 index.ts:293、consolidate.ts:62/89），但须在 PR review 显式验证不引入通配扫描 |
| A4 | 启动时 `rebuildIndexFromMarkdown()` 重建 < 1s（单用户量级） | Don't Hand-Roll | 现有 `data/memory/` 仅数十文件；若未来破千需评估。本期可接受 |
| A5 | `usage` 字段（promptTokens/completionTokens/totalTokens）DeepSeek provider 返回 | Code Examples / Example 1 | DeepSeek 兼容 OpenAI usage 格式（已用 `@ai-sdk/deepseek@2`），应返回；planner 验证 |
| A6 | consolidator 阈值默认 `importance < 0.2`、`60 天` 为保守不误删 | Standard Stack / Example 6 | CONTEXT.md D-03 已定此为保守默认；用户可调 |

**若此表为空则所有声明均已 verified/cited。** 本表有 6 项 `[ASSUMED]`，planner 须在 Wave 0 单测验证 A1/A5（provider 字段），其余 A2/A3/A4/A6 为设计选择已在 CONTEXT.md 用户确认范围内。

## Open Questions (RESOLVED via plan incorporation)

1. **`onStepEnd` 的 `performance` 字段在 DeepSeek provider 下是否填充？**
   - What we know: Context7 示例显示 `performance` 字段存在；AI SDK 文档说 performance 含 `totalMs`。
   - What's unclear: DeepSeek provider 是否实现 performance 上报。
   - Recommendation: Wave 0 单测用 `mockChatCompletion`（现有夹具）跑一次 `generateText` 验证 `onStepEnd` 拿到的 `performance`；若空则 fallback `Date.now()` 差值计 durationMs。

2. **D-10 重试是否应在重试间退避（backoff）？**
   - What we know: CONTEXT.md D-10 建议 1-2 次重试。
   - What's unclear: 是否需要指数退避（避免压垮 DeepSeek API）。
   - Recommendation: 本期 1 次重试无需退避（2 attempts 间隔可忽略）；若扩到 3+ 次再加 backoff。planner 可加 `checkpoint:human-verify` 让用户定。

3. **`.archive/` 是否需要定期清理（否则本身无界增长）？**
   - What we know: D-01 软删除避免误删；但归档本身会累积。
   - What's unclear: 归档保留多久。
   - Recommendation: 本期不自动清归档（D-02 已定不自动触发任何 cleanup）；归档清理 defer 到 Phase 4 反思周期。planner 在 PLAN 注明"归档无界直到 P4"。

4. **`recordWanderSummary`（react.ts:233）在空游荡（未 speak）下记录什么？**
   - What we know: 现状记录 `spoke: lastSpoke?.spoke || '（本次未分享）'`。
   - What's unclear: 废除强制 speak 后，空游荡的 summary 是否需调整（D-07 数据粒度）。
   - Recommendation: 保留现有 `'（本次未分享）'` 语义；wanderHistory 已按步记录节点（search/read/record/speak），粒度不丢。本期不改 recordWanderSummary 签名。

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun 运行时 | 全部 | ✓ | 1.3.13 | — |
| `ai`（AI SDK v6） | D-11 按步计数 | ✓ | 6.0.208 | — |
| `@ai-sdk/deepseek` | provider | ✓ | 2.0.39 | — |
| `zod` | schema 校验 | ✓ | 4.4.3 | — |
| Node.js（仅 tsc typecheck） | typecheck | ✓ | v22.21.1 | — |
| `DEEPSEEK_API_KEY` 环境变量 | 真实 LLM 调用测试 | ✓（测试用 mock） | — | 单测用 `mockChatCompletion`/`mockFetchError` 不需真实 key |
| Bun `fs/promises` rename | 原子写索引 | ✓ | 随 Bun | — |

**Missing dependencies with no fallback:** none
**Missing dependencies with fallback:** none（全部就绪）

## Validation Architecture

> nyquist_validation 已启用（`.planning/config.json` workflow.nyquist_validation: true）。本节列出可自动化验证的行为。

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bun test runner（`bun:test`，随 Bun 1.3.13） |
| Config file | 无（Bun test 约定 `*.test.ts`） |
| Quick run command | `bun test src/memory/long-term/ src/agent/react.test.ts src/llm/` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MEM-01 | 索引双写：saveMemory 后 `.index.json` 含条目 | unit | `bun test src/memory/long-term/memory-index.test.ts -t "双写"` | ❌ Wave 0 |
| MEM-01 | 检索命中索引：`getRecentMemories` 不再 `readdir`（mock 计数验证） | unit | `bun test src/memory/long-term/index.test.ts -t "索引命中"` | ❌ Wave 0（扩展现有） |
| MEM-01 | `getMemory` 不再读即写（文件 mtime 不变） | unit | `bun test src/memory/long-term/index.test.ts -t "读不重写"` | ❌ Wave 0 |
| MEM-01 | 原子写：崩溃后索引要么旧要么新（temp+rename） | unit | `bun test src/memory/long-term/memory-index.test.ts -t "原子写"` | ❌ Wave 0 |
| MEM-01 | 启动重建：从 Markdown 重建 `.index.json` | unit | `bun test src/memory/long-term/memory-index.test.ts -t "重建"` | ❌ Wave 0 |
| MEM-02 | `mergeTopicMemories` 走 store（INDEX + .index.json 同步） | unit | `bun test src/memory/long-term/consolidate.test.ts -t "merge 走 store"` | ❌ Wave 0 |
| MEM-02 | 软删除：合并后旧文件在 `.archive/` | unit | `bun test src/memory/long-term/consolidate.test.ts -t "软删除"` | ❌ Wave 0 |
| MEM-02 | 阈值读 config（不硬编码） | unit | `bun test src/memory/long-term/consolidate.test.ts -t "阈值"` | ❌ Wave 0 |
| MEM-02 | cleanupExpired 基于 indexed accessedAt | unit | `bun test src/memory/long-term/consolidate.test.ts -t "过期"` | ❌ Wave 0 |
| MEM-03 | 空游荡不调 speak（废除兜底） | unit | `bun test src/agent/react.test.ts -t "空游荡不推送"` | ❌ Wave 0（扩展现有） |
| MEM-04 | 按步计数：`calls > 1`（多步 loop 后）| unit | `bun test src/agent/react.test.ts -t "按步计数"` | ❌ Wave 0（扩展现有） |
| MEM-04 | 失败也计数（现有测试已验证 ≥1，扩展验证 onStepEnd 路径） | unit | `bun test src/agent/react.test.ts -t "失败计数"` | ✅（现有，需扩展断言） |
| MEM-04 | `getMemory` 区分 not found（null）vs 解析失败（throw） | unit | `bun test src/memory/long-term/index.test.ts -t "错误显式化"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `bun test src/memory/long-term/ src/agent/react.test.ts src/llm/`（快速，< 5s）
- **Per wave merge:** `bun test`（全量）
- **Phase gate:** 全量绿 + `bun run typecheck` 通过后再 `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/memory/long-term/memory-index.test.ts` — 覆盖 MEM-01 双写/原子写/重建/索引命中
- [ ] `src/memory/long-term/consolidate.test.ts` — 覆盖 MEM-02 merge 走 store/软删除/阈值/过期
- [ ] 扩展 `src/memory/long-term/index.test.ts` — getMemory 读不重写、错误显式化
- [ ] 扩展 `src/agent/react.test.ts` — 按步计数（calls>1）、空游荡不推送
- [ ] 共享夹具：复用现有 `src/test/helpers.ts`（`useTempDataDir`/`mockChatCompletion`/`mockFetchError`）—— 无需新增

## Security Domain

> security_enforcement 已启用（`.planning/config.json` workflow.security_enforcement: true，ASVS level 1）。本期改动横跨数据存储与 Agent 层，相关 ASVS 类别如下。

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | 本期无鉴权改动（DeepSeek API key 已存 `.env`，非本期范围） |
| V3 Session Management | no | 无 session 概念（CLI agent） |
| V4 Access Control | no | 单用户本地 agent，无多租户 |
| V5 Input Validation | yes | `.index.json` schema 用 Zod 校验；config 阈值用 Zod；Markdown frontmatter 解析已有 `parseMemoryFrontmatter` |
| V6 Cryptography | no | 无加密需求（本地文件） |
| V7 Error Handling & Logging | yes | D-08/D-09 错误显式化；禁止 silent catch（CLAUDE.md 红线）；INFO 日志覆盖关键操作（D-04） |
| V8 Data Protection | yes（软删除） | D-01 软删除避免不可逆数据丢失；`.archive/` 保留可恢复 |
| V12 Files & Resources | yes | `toSafeFilename` 已防路径遍历（现有测试覆盖）；`.archive/` 路径须同样过 `toSafeFilename` |

### Known Threat Patterns for 本期 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| 索引 schema 漂移致读取异常（脏 `.index.json`） | Tampering | Zod 校验 + version 字段 + 不匹配则 `rebuildIndexFromMarkdown()` 重建 |
| 路径遍历（`.archive/` 写入） | Tampering | 复用现有 `toSafeFilename`（已防 `../` 与分隔符，现有测试覆盖） |
| 索引双写崩溃致不一致 | Tampering | Markdown 先写（真相源优先）+ 启动重建自愈 |
| 配置阈值注入（`agent-config.json` 脏值） | Tampering | Zod 校验 + 缺失字段回退默认（现有模式） |
| silent catch 掩盖真实失败（现状 bug） | Repudiation | D-09 区分 not found vs 抛错；ERROR 日志带上下文（id/操作） |
| LLM 统计失真致无法观测成本 | Repudiation | D-11 按步计数修复；STAT 日志可见真实 calls/tokens |

## Sources

### Primary (HIGH confidence)
- **Context7 /vercel/ai**（ai_6.0.0-beta.128）—— `generateText` `onStepStart`/`onStepEnd`/`onLanguageModelCallStart`/`onLanguageModelCallEnd` 回调签名；`result.steps` 数组；v6 `onFinish`/`totalUsage` vs v7 `onEnd`/`usage` 迁移；*"errors within these callbacks are silently caught"* 关键陷阱。已核实与当前安装版 `ai@6.0.208` 一致。
- **Context7 /oven-sh/bun** —— POSIX `rename` EINTR 重试 + Windows `NtSetInformationFile` + `FILE_RENAME_REPLACE_IF_EXISTS` 原子性证实；temp-file + rename 模式成立。
- **第一手代码核查** —— `src/memory/long-term/index.ts`（getMemory 读即写 :257、updateIndexAfterSave :519、catch 块 :72/206/243/273/349）、`consolidate.ts`（mergeTopicMemories 绕 store :201、硬编码阈值 :108/218、直接 rm :131/237）、`react.ts`（start/end 包装 :182/199、强制 speak :223、STAT 块 :206）、`stats.ts`（模块级状态）、`url-tracker.ts`（cleanupVisitedUrls :179 零调用点）、`types.ts`（MemoryEntry/MemoryConfig schema、toSafeFilename 防遍历）。

### Secondary (MEDIUM confidence)
- **npm registry** —— `ai@6.0.208`、`zod@4.4.3`、`@ai-sdk/deepseek@2.0.39` 版本与仓库确认。
- **gsd-tools package-legitimacy** —— 三包均 `vercel/ai` 或 `colinhacks/zod` 官方仓库，`SUS` 仅为"too-new"启发式误报。
- **`.planning/research/SUMMARY.md`** —— write-manage-read loop 架构（Phase 1 = manage 半边地基）。
- **Generative Agents（Park et al. 2023, arXiv:2304.03442）** —— memory stream + reflection + recency×importance×relevance 检索（Phase 4 反思的理论基础，本期只做索引前提）。

### Tertiary (LOW confidence)
- 无（本期所有结论均有 Context7 或代码核查支撑）。

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH —— 全复用现有栈，版本经 npm 核实
- Architecture (索引双写/原子写/onStepEnd): HIGH —— Context7 双重核实（AI SDK + Bun）
- Code landing points: HIGH —— 逐行核查 react.ts/index.ts/consolidate.ts/stats.ts
- Pitfalls: HIGH —— onStepEnd 静默吞错 + 双写崩溃不一致均有 Context7/代码证据
- 阈值默认值（A6）: MEDIUM —— CONTEXT.md 用户已定保守默认，但"不误删"需运行验证

**Research date:** 2026-06-20
**Valid until:** 2026-07-20（30 天；AI SDK v6 API 稳定，但若升 v7 须重核 onStepEnd→onEnd 迁移）

## RESEARCH COMPLETE
