# Research: Reflection Engine, Memory System & ReAct Loop

> Generated from source code analysis of `packages/agent/src/`.
> All interfaces/signatures are exact copies from the codebase.

---

## 1. Reflection Engine (`memory/reflection/engine.ts`)

### Class: `ReflectionEngine`

```ts
export class ReflectionEngine {
  private cfg: ReflectionConfig;
  constructor(cfg?: Partial<ReflectionConfig>);
  async reflect(): Promise<ReflectionResult2>;
}
```

### `reflect()` Pipeline (6 Steps)

1. **collectObservations()** — Queries `MemoryStore.getRecentMemories({ type: 'observation', count: cfg.maxObservations, since })`, then filters out `provenance === 'self:reflection'` (anti-self-feedback loop). Skips if `< 3` observations.
2. **callLLM(observations)** — Single `generateText()` call (no tools):
   ```ts
   const result = await generateText({
     model: provider.chat(config.llmModel),   // DeepSeek via @ai-sdk/deepseek
     temperature: 0.4,
     system: systemPrompt,                     // Chinese "反思大脑" prompt
     prompt: userPrompt,                       // Formatted observations list
     maxOutputTokens: 3000,
   });
   ```
   - Provider: `createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY })`
   - Model: `config.llmModel` (default `'deepseek-chat'`, env `LLM_MODEL`)
   - **No tools passed** — pure text-in/text-out JSON generation
   - System prompt instructs LLM to output raw JSON (no markdown fences)
3. **parseAndValidate(raw)** — Strips markdown code fences, `JSON.parse`, then `ReflectionResultSchema.safeParse()`. On Zod failure: attempts partial recovery by validating each insight individually.
4. **groundInsights(insights, observations)** — Validates each insight's `sourceIds` against actual observation IDs. Insights with zero valid sources are discarded. Valid sourceIds are trimmed in-place.
5. **writeInsights(insights)** — Writes each insight to MemoryStore as `type: 'observation'`, `provenance: 'self:reflection'`, `importance: 0.7`, tags include `['reflection', 'insight', 'ref:<sourceId>']`.
6. **updateInterestGraph(insights)** — Applies `newInterests` (via `graph.addInterest()`) and `existingInterestUpdates` (via `graph.reinforce()` or direct weight decay) to the InterestGraph, then `graph.persist()`.

### Return Type: `ReflectionResult2`

```ts
export interface ReflectionResult2 {
  executed: boolean;
  insightsProduced: number;
  insightsDiscardedByGrounding: number;
  insightsDiscardedByValidation: number;
  newInterestsAdded: string[];
  existingInterestsUpdated: string[];
}
```

### Singleton

```ts
export function getReflectionEngine(cfg?: Partial<ReflectionConfig>): ReflectionEngine;
export function _resetReflectionEngine(): void;  // test isolation
```

---

## 2. Reflection Types (`memory/reflection/types.ts`)

### Provenance

```ts
export type Provenance = 'untrusted:web' | 'self:reflection';
export const DEFAULT_PROVENANCE: Provenance = 'untrusted:web';
```

### Zod Schemas (LLM output validation)

```ts
export const NewInterestSchema = z.object({
  topic: z.string().min(1).max(30),
  weight: z.number().min(0).max(0.5),       // capped low for caution
  reasoning: z.string().min(1).max(200),
});

export const InterestUpdateSchema = z.object({
  topic: z.string().min(1).max(30),
  delta: z.number().min(-0.1).max(0.2),     // small adjustments only
  reasoning: z.string().min(1).max(200),
});

export const ReflectionInsightSchema = z.object({
  title: z.string().min(1).max(100),
  content: z.string().min(1).max(500),
  sourceIds: z.array(z.string().min(1)).min(1).max(10),  // grounding: ≥1 required
  newInterests: z.array(NewInterestSchema).max(3),
  existingInterestUpdates: z.array(InterestUpdateSchema).max(5),
});

export const ReflectionResultSchema = z.object({
  insights: z.array(ReflectionInsightSchema).min(0).max(10),
  summary: z.string().max(300),
});
```

### Inferred Types

```ts
export type NewInterest = z.infer<typeof NewInterestSchema>;
export type InterestUpdate = z.infer<typeof InterestUpdateSchema>;
export type ReflectionInsight = z.infer<typeof ReflectionInsightSchema>;
export type ReflectionResult = z.infer<typeof ReflectionResultSchema>;
```

### ReflectionConfig

```ts
export interface ReflectionConfig {
  wanderInterval: number;    // trigger every N wanders
  hourInterval: number;      // or every M hours (whichever first)
  maxObservations: number;   // max observations fed to LLM
  lookbackDays: number;      // observation lookback window
  maxInsights: number;       // max insights per reflection
  enabled: boolean;          // master switch
}

export const DEFAULT_REFLECTION_CONFIG: ReflectionConfig = {
  wanderInterval: 5,
  hourInterval: 4,
  maxObservations: 30,
  lookbackDays: 7,
  maxInsights: 5,
  enabled: true,
};
```

### SchedulerState

```ts
export interface SchedulerState {
  wanderCount: number;
  lastReflectionAt: string | null;
  totalReflections: number;
}

export function createDefaultSchedulerState(): SchedulerState;
```

---

## 3. Reflection Scheduler (`memory/reflection/scheduler.ts`)

### Class: `ReflectionScheduler`

```ts
export class ReflectionScheduler {
  constructor(cfg?: Partial<ReflectionConfig>, state?: SchedulerState, statePath?: string);
  async load(): Promise<void>;       // load state from data/reflection-state.json
  async persist(): Promise<void>;    // atomic write (tmp + rename), serialized via promise chain
  async tick(): Promise<boolean>;    // called after each wander; returns true if reflection triggered
  getState(): Readonly<SchedulerState>;
}
```

### Trigger Logic (`tick()` → `checkTrigger()`)

Three conditions (any one triggers):
1. `wanderCount % wanderInterval === 0` (every N wanders)
2. Hours since `lastReflectionAt` >= `hourInterval`
3. First-time: `lastReflectionAt === null && wanderCount >= wanderInterval`

Anti-overlap: `this.reflecting` boolean guard prevents concurrent reflections.

### Execution Flow

`tick()` → increments `wanderCount` → persists → checks trigger → fires `executeReflection()` **asynchronously** (does not await; `.finally()` clears the guard). `executeReflection()` calls `getReflectionEngine(this.cfg).reflect()`, then updates `lastReflectionAt` and `totalReflections`.

### State Persistence

File: `data/reflection-state.json` (via `getDataPath()`). Atomic write: unique tmp filename with pid+timestamp+random, then `rename()`.

### Singleton

```ts
export function getReflectionScheduler(cfg?: Partial<ReflectionConfig>): ReflectionScheduler;
export function _resetReflectionScheduler(): void;
```

---

## 4. Memory System (`memory/long-term/`)

### 4.1 MemoryEntry (`long-term/types.ts`)

```ts
export type MemoryType = 'profile' | 'knowledge' | 'interaction' | 'observation';
export type Provenance = 'untrusted:web' | 'self:reflection';

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  timestamp: string;
  tags: string[];
  summary: string;
  content: string;
  importance: number;
  accessedAt?: string;
  provenance?: Provenance;
}
```

### 4.2 Storage Pattern: Markdown + JSON Sidecar

**Markdown files** are the source of truth. Each memory = one `.md` file with YAML-like frontmatter:

```markdown
---
id: observation-1721234567890-abc123def456
type: observation
timestamp: 2025-07-17T12:00:00.000Z
tags: reflection, insight, ref:xxx
importance: 0.7
provenance: self:reflection
---

## [反思洞察] Title here

Content here...
```

**Directory structure** (`basePath = 'data/memory'`):

```
data/memory/
├── INDEX.md                    # human-readable index
├── .index.json                 # JSON sidecar (query index)
├── profile/                    # type: 'profile'
├── knowledge/                  # type: 'knowledge'
├── interactions/               # type: 'interaction'
└── observations/               # type: 'observation'
```

Path mapping:
```ts
export const MEMORY_TYPE_PATHS: Record<MemoryType, string> = {
  profile: 'profile',
  knowledge: 'knowledge',
  interaction: 'interactions',
  observation: 'observations',
};
```

**JSON sidecar** (`.index.json`) — derived query index:
```ts
export interface MemoryIndexRecord {
  id: string;
  type: MemoryType;
  timestamp: string;
  accessedAt: string;
  importance: number;
  tags: string[];
  summary: string;
  filepath: string;         // relative to basePath, e.g. "observations/xxx.md"
}

export interface MemoryJsonIndex {
  version: 1;               // literal, schema drift guard
  lastUpdated: string;
  records: MemoryIndexRecord[];
}
```

**Triple-write on save**: Markdown file → INDEX.md → `.index.json` (via `updateIndexAfterSave()`).
**Crash recovery**: `ensureIndexConsistent()` at startup — if `.index.json` missing/corrupt/empty but Markdown files exist → `rebuildIndexFromMarkdown()`.

### 4.3 MemoryStore Class (`long-term/index.ts`)

```ts
export class MemoryStore {
  constructor(config: Partial<MemoryConfig> = {});

  // Index
  async readIndex(): Promise<MemoryIndex>;
  async updateIndex(updates: Partial<MemoryIndex>): Promise<void>;
  async writeIndex(index: MemoryIndex): Promise<void>;

  // CRUD
  async saveMemory(entry: Omit<MemoryEntry, 'id'> & { id?: string }): Promise<MemoryEntry>;
  async getMemory(type: MemoryType, id: string): Promise<MemoryEntry | null>;
  async getRecentMemories(options?: { count?: number; type?: MemoryType; since?: string }): Promise<MemoryEntry[]>;
  async searchMemories(query: string): Promise<MemoryEntry[]>;
  async deleteMemory(type: MemoryType, id: string): Promise<boolean>;

  // Index maintenance
  async unlinkFromIndex(type: MemoryType, id: string): Promise<void>;
  async ensureIndexConsistent(): Promise<void>;
  async getMemoryAccessedAt(type: MemoryType, id: string): Promise<string | null>;

  // Prompt context
  async buildMemoryContext(options?: MemoryContextOptions): Promise<string>;
}
```

Key behaviors:
- `getRecentMemories()` queries the JSON sidecar index (O(1) lookup), then reads only matched Markdown files.
- `saveMemory()` generates ID via `generateMemoryId(type, content)` = `{type}-{timestamp}-{sha256(content)[0:16]}`.
- `buildMemoryContext()` scores memories by importance × recency × keyword match, selects within token budget (2.5 chars/token estimate), formats as markdown sections.

### 4.4 MemoryIndex Class (`long-term/memory-index.ts`)

```ts
export class MemoryIndex {
  constructor(jsonPath: string, basePath: string);
  async getRecords(): Promise<MemoryIndexRecord[]>;
  async upsert(entry: MemoryEntry): Promise<void>;
  async remove(type: MemoryType, id: string): Promise<void>;
  async queryRecent(options?: QueryRecentOptions): Promise<MemoryIndexRecord[]>;
  async touchAccessedAt(type: MemoryType, id: string): Promise<void>;
  async getAccessedAt(type: MemoryType, id: string): Promise<string | null>;
  async rebuild(): Promise<void>;
  async persist(): Promise<void>;    // atomic write, serialized via promise chain
}
```

- Lazy loading with in-flight dedup (`loadPromise`).
- `persist()` uses unique tmp filename (pid+timestamp+random) + rename for concurrency safety.

### 4.5 High-Level Write API (`long-term/write.ts`)

```ts
export async function recordInteraction(params: { action: string; content: string; result?: string; tags?: string[] }): Promise<MemoryEntry>;
export async function recordFeedback(params: { type: 'like' | 'dislike'; topic: string; content?: string }): Promise<MemoryEntry>;
export async function recordKnowledge(params: { topic: string; title: string; content: string; source?: string; url?: string }): Promise<MemoryEntry>;
export async function recordObservation(params: { title: string; content: string; tags?: string[] }): Promise<MemoryEntry>;
export async function updateUserPreference(params: { key: string; value: string; type: 'like' | 'dislike' | 'neutral' }): Promise<void>;
export async function recordWanderSummary(params: { steps: number; topics: string[]; spoke: string; duration?: number }): Promise<MemoryEntry>;
```

### 4.6 High-Level Read API (`long-term/read.ts`)

```ts
export async function getUserProfile(): Promise<MemoryEntry[]>;
export async function getUserPreferences(): Promise<{ likes: string[]; dislikes: string[] }>;
export async function getRecentInteractions(days?: number): Promise<MemoryEntry[]>;
export async function getTopicKnowledge(topic: string, count?: number): Promise<MemoryEntry[]>;
export async function getObservations(count?: number): Promise<MemoryEntry[]>;
export async function searchMemory(query: string): Promise<MemoryEntry[]>;
export async function buildMemoryPromptContext(options?: MemoryContextOptions): Promise<string>;
export async function getMemoryStats(): Promise<{ total: number; byType: Record<MemoryType, number>; recentCount: number; importantCount: number }>;
export async function getTodaySummary(): Promise<string>;
```

### 4.7 Module Barrel Export (`memory/long-term.ts`)

Re-exports: `MemoryStore`, `getMemoryStore`, all types, `InterestGraph` + helpers, all write functions, all read functions, `MemoryConsolidator`.

---

## 5. ReAct Loop (`agent/react.ts`)

### Main Function Signature

```ts
export async function runAgentLoop(state: AgentState): Promise<WanderResult>;
```

### Return Type

```ts
export interface WanderResult {
  steps: number;
  durationMs: number;
  spokeTimes: number;
  visitedUrls: string[];
  endReason: 'rest' | 'max_steps' | 'low_energy' | 'error';
}
```

### ToolContext (shared mutable state across tools)

```ts
export interface ToolContext {
  state: AgentState;
  traceId: string;
  stepCount: number;
  wanderHistory: WanderStep[];
  visitedUrls: string[];
  spokeTimes: number;
  pendingFeedbackCount: number;
  endReason: 'rest' | 'max_steps' | 'low_energy' | 'error';
  startTime: number;
  searchQueries: SearchRecord[];
}
```

### Execution Flow

1. **Initialize context** — Create mutable `ToolContext`, reset LLM stats.
2. **Ensure tools initialized** — `ToolManager.initialize()` (lazy, once).
3. **Build prompts**:
   - `loadUserProfile()` → user likes/dislikes
   - `buildMemoryPromptContext()` → recent memories formatted as markdown
   - `buildReactSystemPrompt(state, userProfile, memoryContext)` — full persona + state + interests + behavior rules + memory tool instructions
   - `buildReactUserPrompt({ state, userProfile, stepNumber: 1, maxSteps, lastToolResult: null, wanderHistory: [] })` — initial observation prompt
4. **Get tools** — `ToolManager.getTools(ctx)` returns `Record<string, Tool>` for AI SDK.
5. **Call generateText** with retry loop:
   ```ts
   await generateText({
     model: provider.chat(config.llmModel),
     temperature: config.wanderTemperature,    // default 0.9
     system: systemPrompt,
     prompt: initialUserPrompt,
     stopWhen: [hasToolCall('rest'), stepCountIs(maxSteps)],
     tools,                                     // Record<string, Tool>
     onStepFinish({ stepNumber, usage }) { recordStep(...); },
   });
   ```
   - **Provider**: `createDeepSeek({ apiKey })` from `@ai-sdk/deepseek`
   - **Stop conditions**: LLM calls `rest` tool OR reaches `maxSteps` (default 10)
   - **Retry**: up to `config.generateTextMaxRetries` (default 1) retries on total failure
   - AI SDK handles the multi-step tool loop internally (LLM → tool call → execute → LLM → ...)
6. **Post-loop**:
   - Step count from `llmStats.calls` (includes text-only steps)
   - `recordWanderSummary()` → saves to long-term memory
   - `appendWanderHistory()` → appends to `data/wander-history.json` (max 100 entries)
   - `updateState()` → updates boredom, energy, recentTopics, counters

### Registered Tools (8 total)

From `auto-register.ts`:
| Tool Name | Category | File |
|---|---|---|
| `search_web` | search | `search-web.ts` |
| `read_page` | web | `read-page.ts` |
| `speak` | content | `speak.ts` |
| `rest` | content | `rest.ts` |
| `record_knowledge` | memory | `record-knowledge.ts` |
| `observe_user` | memory | `observe-user.ts` |
| `read_feedback` | feedback | `read-feedback.ts` |
| `process_feedback` | feedback | `read-feedback.ts` |

### ToolManager (`tools/tool-manager.ts`)

```ts
export class ToolManager {
  static register(def: ToolDefinition): void;
  static batchRegister(defs: ToolDefinition[]): void;
  static setEnabled(name: string, enabled: boolean): void;
  static isEnabled(name: string): boolean;
  static getMetadata(enabledOnly?: boolean): ToolMetadata[];
  static getTools(ctx: ToolContext): Record<string, Tool>;        // for AI SDK
  static getToolsFiltered(ctx: ToolContext, options?: { only?: string[]; exclude?: string[] }): Record<string, Tool>;
  static async initialize(): Promise<void>;
  static reset(): void;
}

export interface ToolDefinition {
  metadata: ToolMetadata;
  createTool: (ctx: ToolContext) => Tool;    // factory receives shared context
}

export interface ToolMetadata {
  name: string;
  description: string;
  category?: 'search' | 'web' | 'content' | 'memory' | 'feedback';
  enabled?: boolean;
}
```

Key pattern: Each tool's `createTool(ctx)` closes over the shared `ToolContext`, so tool executions mutate the same `ctx` (stepCount, visitedUrls, spokeTimes, etc.).

---

## 6. Entry Point & Startup Sequence (`index.ts`)

### `main()` Startup Order

```
1. initLogger()                          — TUI + file logging
2. validateConfig()                      — checks DEEPSEEK_API_KEY, search keys, push keys
3. initFeishuWS()                        — Feishu WebSocket event subscription
4. loadState() → updateState(state)      — load agent state, push to TUI
5. initializeInterestGraph(config)       — Phase 2: seed + decay + persist interest graph
6. runStartupMemoryMaintenance()         — best-effort, non-blocking:
   a. getMemoryStore().ensureIndexConsistent()   — CR-01 index self-heal
   b. cleanupVisitedUrls(urlCleanupDays)         — purge old URL dedup records
   c. consolidator.consolidateOldMemories()      — merge old memories
   d. consolidator.cleanupExpired()              — soft-delete expired
7. initReflectionScheduler()             — Phase 4: scheduler.load() from reflection-state.json
8. registerSignalHandlers()              — SIGINT/SIGTERM graceful shutdown
9. startHeartbeat()                      — immediately runs first heartbeat
```

### Heartbeat Loop (`runHeartbeat()`)

```
1. loadState() → getHeartbeatParams(state)    — energy-based tier (interval, recovery, boredomGrowth)
2. updateHeartbeatInterval(params.interval)   — dynamic timer adjustment
3. heartbeat(boredomGrowth, recovery, threshold) — update state (boredom grows, energy recovers)
4. Probability gate: if energy < threshold, skip wander with probability (energy/100)
5. runAgentLoop(newState)                     — THE REACT LOOP
6. getReflectionScheduler().tick()            — Phase 4: async, non-blocking
```

### Signal Handlers (Graceful Shutdown)

On SIGINT/SIGTERM:
1. Stop heartbeat timer
2. Close Feishu WebSocket (`closeFeishuWS()`)
3. Save state (`saveState()`)
4. Shutdown TUI or `process.exit(0)`
- 3-second force-exit timeout guard

### Energy Recovery Tiers (default)

| maxEnergy | recovery | interval (min) | boredomGrowth |
|-----------|----------|-----------------|---------------|
| 10 | 10 | 30 | 0 |
| 30 | 5 | 15 | 2 |
| 100 | 2 | 10 | 5 |

---

## 7. Key Config Values (`config.ts`)

```ts
export const config: AgentConfig = {
  llmModel: process.env.LLM_MODEL || 'deepseek-chat',
  maxWanderSteps: 10,
  wanderTemperature: 0.9,
  llmTemperature: 0.8,
  energyCostPerStep: 2,
  boredomReductionPerStep: 2,
  generateTextMaxRetries: 1,
  outputLanguage: 'zh-CN',
  searchProvider: process.env.SEARCH_PROVIDER || 'duckduckgo',
  // ... plus consolidation, interests, pushGate nested configs
};

export function getDataPath(filename: string): string {
  return `${process.env.DATA_DIR ?? 'data'}/${filename}`;
}
```

---

## 8. Architecture Summary

```
┌─────────────────────────────────────────────────────────┐
│                     index.ts main()                      │
│  initLogger → validateConfig → initFeishuWS → loadState │
│  → initInterestGraph → memoryMaintenance                │
│  → initReflectionScheduler → signalHandlers → heartbeat │
└──────────────────────────┬──────────────────────────────┘
                           │ setInterval
                    ┌──────▼──────┐
                    │  Heartbeat  │ ← energy-tier dynamic interval
                    └──────┬──────┘
                           │ probability gate
                    ┌──────▼──────┐
                    │ runAgentLoop│ ← ReAct: generateText + tools
                    │  (react.ts) │   stopWhen: rest | maxSteps
                    └──────┬──────┘
                           │ tools mutate ToolContext
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         search_web    read_page     speak/rest
         record_knowledge  observe_user  read_feedback
                           │
                    ┌──────▼──────┐
                    │ scheduler   │ ← tick() after each wander
                    │  .tick()    │   triggers every 5 wanders / 4 hours
                    └──────┬──────┘
                           │ async
                    ┌──────▼──────┐
                    │ Reflection  │ ← generateText (no tools, JSON output)
                    │  Engine     │   observations → insights → memory
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         MemoryStore   InterestGraph   reflection-state.json
         (md + json)   (interest-graph)
```

### Key Patterns for New Tool/Module Integration

1. **Adding a new tool**: Create `ToolDefinition` in `tools/registry/<name>.ts`, add to `TOOL_DEFINITIONS` array in `auto-register.ts`. The `createTool(ctx)` factory receives the shared `ToolContext`.
2. **Writing memories**: Use `getMemoryStore().saveMemory()` or high-level helpers from `long-term/write.ts`.
3. **Reading memories for prompts**: `buildMemoryPromptContext()` → injected into system prompt.
4. **Reflection integration**: Reflection engine reads `type: 'observation'` memories, writes back with `provenance: 'self:reflection'`.
5. **Config**: Behavior params in `data/agent-config.json`, secrets in env vars, `getDataPath()` for DATA_DIR isolation.
