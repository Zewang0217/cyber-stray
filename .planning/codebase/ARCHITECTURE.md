<!-- refreshed: 2026-06-20 -->
# Architecture

**Analysis Date:** 2026-06-20

## System Overview

Cyber Stray (赛博街溜子) is an autonomous AI agent that "wanders the internet" on a heartbeat schedule, uses a ReAct loop driven by Vercel AI SDK + DeepSeek to search/read/speak, pushes findings to Feishu/Telegram, and exposes a Next.js dashboard that reads its JSON file state.

```text
┌──────────────────────────────────────────────────────────────────────┐
│                         ENTRY & LIFECYCLE                             │
│  `src/index.ts` — main() → validateConfig → initFeishuWS → heartbeat  │
│        signal handlers (SIGINT/SIGTERM) → graceful shutdown           │
└──────────┬─────────────────────────────────┬──────────────────────────┘
           │                                  │
           ▼                                  ▼
┌─────────────────────────┐    ┌──────────────────────────────────────┐
│   OBSERVABILITY LAYER   │    │            AGENT CORE                 │
│ `src/tui/index.tsx`     │    │  `src/agent/state.ts` — load/save/    │
│  Ink TUI (fallback txt) │    │   heartbeat AgentState                │
│ `src/logger.ts`         │    │  `src/agent/react.ts` — runAgentLoop  │
│ `src/logger/file-writer │    │   (generateText + tools + stopWhen)   │
│   .ts` + `log-cleaner`  │    └──────────────────┬───────────────────┘
└─────────────────────────┘                       │
                                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      TOOL LAYER (AI SDK tools)                        │
│  `src/tools/tool-manager.ts` (registry) ← `registry/auto-register.ts`│
│  search_web · read_page · speak · rest · record_knowledge ·          │
│  observe_user · read_feedback · process_feedback                     │
│  Shared mutable context: `registry/context.ts` (ToolContext)         │
└──────┬──────────────────┬──────────────────┬──────────────┬──────────┘
       │                  │                  │              │
       ▼                  ▼                  ▼              ▼
┌────────────┐  ┌──────────────────┐  ┌────────────┐  ┌──────────────┐
│ SEARCH     │  │ PAGE READER      │  │ PUSH       │  │ MEMORY       │
│ search/    │  │ page/reader.ts   │  │ push/      │  │ memory/      │
│ adapter.ts │  │ JSDOM+Readability│  │ speak.ts   │  │ long-term/   │
│ DDG/Tavily/│  │                  │  │ lark-sender│  │ user-profile │
│ Exa        │  │                  │  │ +telegram  │  │ feedback-    │
│            │  │                  │  │            │  │ store        │
└────────────┘  └──────────────────┘  └─────┬──────┘  └──────────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │ EXTERNAL PUSH    │
                                   │ Feishu Lark WS   │
                                   │ feishu/ws-client │
                                   │ (incoming emoji  │
                                   │  → feedback)     │
                                   └──────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                  FILESYSTEM STATE (single source of truth)            │
│  data/state.json · data/agent-config.json · data/memory/*.md         │
│  data/history/*.jsonl · data/dedup/visited-urls.json · data/logs/    │
└──────────────────────────────────────────────────────────────────────┘
           ▲
           │ read-only HTTP (relative ../data)
┌──────────────────────────────────────────────────────────────────────┐
│             WEB DASHBOARD (separate Next.js app in `web/`)            │
│  app/api/{state,history}/route.ts → poll → useAgentState / useHistory│
│  Framer Motion + Tailwind 4 + Three.js components                     │
└──────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Entry / lifecycle | Boot, config validation, heartbeat scheduler, signal handlers, graceful shutdown | `src/index.ts` |
| Config | Loads `data/agent-config.json` (behavior) + env vars (secrets), `validateConfig()` gates startup | `src/config.ts` |
| Types | All shared TS interfaces (`AgentState`, `AgentConfig`, `SearchResult`, `PushContent`, etc.) | `src/types.ts` |
| State persistence | load/save/update `AgentState`, heartbeat math, feedback-driven mood updates | `src/agent/state.ts` |
| ReAct loop | Builds prompts, runs `generateText` with tools + `stopWhen`, aggregates stats, writes wander history | `src/agent/react.ts` |
| Tool registry | `ToolManager` singleton, `ToolDefinition` shape, enable/disable, `getTools(ctx)` for AI SDK | `src/tools/tool-manager.ts` |
| Tool wiring | Single `registerAllTools()` call site; new tools MUST be added here | `src/tools/registry/auto-register.ts` |
| Tool context | Mutable `ToolContext` shared across tool executions in one wander | `src/tools/registry/context.ts` |
| Search adapter | Strategy interface + provider selection with DuckDuckGo fallback | `src/tools/search/adapter.ts`, `src/tools/search/index.ts` |
| Page reader | Fetch + JSDOM + Readability, returns content + extracted links | `src/tools/page/reader.ts` |
| Push | Multi-channel (Feishu LarkChannel / Webhook / Telegram), records history | `src/tools/push/speak.ts`, `src/tools/push/lark-sender.ts` |
| Long-term memory | `MemoryStore` class, Markdown files + `INDEX.md`, token-budget context builder | `src/memory/long-term/index.ts` |
| User profile | Like/dislike tracking with cooldown-gated writes | `src/memory/user-profile.ts` |
| Feedback loop | Feishu WebSocket emoji events → feedback store → mood/profile | `src/tools/feishu/ws-client.ts`, `src/memory/feedback-store.ts` |
| Dedup | Cross-wander URL cooldown (default 5 days), base64url hash | `src/tools/dedup/url-tracker.ts` |
| Logger | `consola` with custom file reporter + log-callback fan-out to TUI | `src/logger.ts`, `src/logger/file-writer.ts` |
| TUI | Ink (React for terminal) dashboard; falls back to text mode if non-TTY | `src/tui/App.tsx`, `src/tui/index.tsx` |
| Web dashboard | Next.js 16 app, reads `../data/*.json` via API routes, polls every 5s | `web/app/page.tsx`, `web/app/api/*/route.ts` |

## Pattern Overview

**Overall:** Event-driven ReAct agent with a single mutable context per wander, file-based persistence, and a thin observability skin (TUI/Web) that only reads state.

**Key Characteristics:**
- No planner: `src/agent/planner.ts`, `src/agent/actions.ts`, and `src/constants/decision.ts` are **deprecated** legacy pipeline code — the only live decision loop is `runAgentLoop` using AI SDK tool calling.
- Single source of truth is the filesystem (`data/*.json`, `data/memory/*.md`). All modules read/write these files directly; there is no in-memory DB or queue.
- Lazy singletons (`getProvider`, `getMemoryStore`, `ToolManager.initialize`) memoize across the process lifetime.
- Module-level mutable state is the dominant state-sharing mechanism (see Architectural Constraints).

## Layers

**Entry & Lifecycle (`src/index.ts`):**
- Purpose: boot, schedule heartbeat, handle SIGINT/SIGTERM, graceful shutdown (3s timeout fallback).
- Location: `src/index.ts`
- Contains: `main`, `registerSignalHandlers`, `startHeartbeat`, `runHeartbeat`.
- Depends on: `config`, `state`, `react`, `logger`, `tui`, `feishu/ws-client`.
- Used by: process (`bun run dev` / `bun run src/index.ts`).

**Agent Core (`src/agent/`):**
- Purpose: state machine + ReAct loop.
- Location: `src/agent/state.ts`, `src/agent/react.ts`.
- Contains: `loadState/saveState/updateState/heartbeat`, `runAgentLoop`.
- Depends on: `prompts/react.ts`, `tools/registry/index.ts`, `memory/long-term.ts`, `memory/user-profile.ts`, `llm/client.ts`.
- Used by: `src/index.ts` (heartbeat), `feishu/ws-client.ts` (feedback mood updates).

**Tool Layer (`src/tools/`):**
- Purpose: expose capabilities to the LLM as AI SDK tools; encapsulate search, web, content, memory, feedback categories.
- Location: `src/tools/registry/*.ts` (definitions), `src/tools/{search,page,push,filter,dedup,content}/` (implementations).
- Contains: 8 registered tools + supporting adapters/readers/senders.
- Depends on: `config`, `logger`, `types`, `memory/*`.
- Used by: `runAgentLoop` via `ToolManager.getTools(ctx)`.

**Memory Layer (`src/memory/`):**
- Purpose: three-tier memory (user profile JSON, long-term Markdown store, feedback store).
- Location: `src/memory/user-profile.ts`, `src/memory/long-term/` (split into `index.ts`/`read.ts`/`write.ts`/`consolidate.ts`/`types.ts`), `src/memory/feedback-store.ts`.
- Contains: `MemoryStore` class + functional write/read helpers + prompt context builder.
- Depends on: `logger`, `config` (only `getDataPath`-style paths).
- Used by: `react.ts` (context + wander summary), tool definitions (`record_knowledge`, `observe_user`, `read_feedback`), `feishu/ws-client.ts`.

**Observability Layer (`src/logger/`, `src/tui/`):**
- Purpose: structured logs to `data/logs/YYYY-MM-DD.log`, TUI rendering via log-callback fan-out.
- Location: `src/logger.ts`, `src/logger/{file-writer,log-cleaner,trace}.ts`, `src/tui/App.tsx`, `src/tui/components/*.tsx`.
- Contains: `consola` instance, `onLog` callback registry, React components (`StatusBar`, `LogView`, `Loading`, `ErrorBoundary`).
- Depends on: `consola`, `ink`, `react`, `types`.
- Used by: every layer that logs.

**Web Dashboard (`web/`):**
- Purpose: separate Next.js 16 app that reads agent state via HTTP polling.
- Location: `web/app/` (pages, API routes), `web/components/`, `web/hooks/`, `web/lib/`.
- Contains: dashboard page, history page, settings page, `/api/state` and `/api/history` routes.
- Depends on: Next.js, Framer Motion, Tailwind 4, Three.js (via `@react-three/fiber`).
- Used by: end users (browser); runs independently from the agent process.

## Data Flow

### Primary Request Path — Wander (heartbeat-triggered)

1. `setInterval(runHeartbeat, intervalMs)` fires (`src/index.ts:155`).
2. `loadState()` + `getHeartbeatParams(state)` (energy-tiered interval) → `updateHeartbeatInterval` (`src/index.ts:165`).
3. `heartbeat(boredomGrowth, recovery, threshold)` mutates `state.json` (`src/agent/state.ts:113`).
4. Probability gate: if `energy < wanderProbabilityThreshold`, roll `Math.random()` against `energy/100` to skip (`src/index.ts:202`).
5. `runAgentLoop(newState)` — resets LLM stats, builds `ToolContext`, loads user profile + memory context, builds system/user prompts (`src/agent/react.ts:124`).
6. `generateText({ model: provider.chat(model), tools, stopWhen: [hasToolCall('rest'), stepCountIs(maxSteps)] })` — LLM autonomously calls `search_web` / `read_page` / `speak` / `rest` / `record_knowledge` / `observe_user` / `read_feedback`. Each tool execute mutates `ctx` (`stepCount`, `wanderHistory`, `visitedUrls`, `spokeTimes`).
7. Post-loop: empty-wander fallback speak, `recordWanderSummary`, append `data/wander-history.json`, `updateState` with cost/recovery math (`src/agent/react.ts:208`).

### Feedback Flow — incoming (Feishu emoji)

1. Feishu user adds 👍/👎 to a message → LarkChannel WebSocket event (`src/tools/feishu/ws-client.ts:51`).
2. `recordFeedback({ type, messageId, userId })` writes to `data/feedback.json` (`src/memory/feedback-store.ts`).
3. `updateMoodByFeedback(type)` adjusts `temper`/`mood` in `state.json` (`src/agent/state.ts:146`).
4. Next wander: LLM calls `read_feedback` tool → sees pending feedbacks → may call `observe_user` with `profile_change` → `tryUpdateUserProfile` enforces 30-min cooldown.

### Dashboard Flow

1. Browser hits `web/` → `useAgentState` polls `/api/state` every 5s (`web/hooks/useAgentState.ts:41`).
2. `/api/state` reads `../data/state.json` directly (`web/app/api/state/route.ts:11`).
3. `/api/history` reads `../data/history/*.json` files (`web/app/api/history/route.ts`).
4. Note: `../data` is relative to `web/` cwd — the web app must be started from `web/` while agent runs in repo root.

**State Management:**
- Agent process: module-level singletons (`_provider`, `defaultStore`, `channel`, `heartbeatTimer`) + per-wander `ToolContext` object.
- Persistence: every state change writes through `updateState` → `data/state.json`. No write batching; partial updates are merge-and-overwrite.
- Cross-process: none. Web dashboard has no IPC with the agent; both read/write the same files on disk.

## Key Abstractions

**ToolDefinition + ToolManager:**
- Purpose: declarative tool registration with metadata (name/description/category/enabled) and a `createTool(ctx)` factory.
- Examples: `src/tools/registry/search-web.ts`, `src/tools/registry/speak.ts`, every file in `registry/`.
- Pattern: registry singleton + factory closure capturing `ctx`. New tool = new file in `registry/` exporting a `*ToolDef` + import in `auto-register.ts`.

**SearchAdapter (Strategy):**
- Purpose: pluggable search backend behind one interface.
- Examples: `src/tools/search/duckduckgo.ts`, `src/tools/search/tavily.ts`, `src/tools/search/exa.ts`.
- Pattern: `SearchAdapter` interface (`search`, `getName`, `isAvailable`); `search/index.ts` picks by `config.searchProvider` with DuckDuckGo fallback; `premiumSearch` prefers Exa then Tavily.

**ToolContext (mutable scratchpad):**
- Purpose: single shared object passed to every tool's `createTool(ctx)`, mutated in place during one wander.
- Examples: `src/tools/registry/context.ts:14`.
- Pattern: object reference captured by closure; tools push via `pushWanderStep(ctx, step)`.

**MemoryStore (file-based repository):**
- Purpose: Markdown-per-entry memory with frontmatter + `INDEX.md` aggregate, token-budget context selection.
- Examples: `src/memory/long-term/index.ts`.
- Pattern: class with lazy singleton `getMemoryStore()`; `saveMemory` writes file then updates index; `buildMemoryContext` scores by importance × recency × keyword match.

**consola + onLog callback:**
- Purpose: single logger with a file reporter that fans out structured entries to subscribers (TUI, fallback text mode).
- Examples: `src/logger.ts:27` (`fileReporter`), `src/logger.ts:17` (`onLog`).
- Pattern: push-based pub/sub; `src/tui/index.tsx:96` registers the TUI subscriber.

## Entry Points

**Process entry:**
- Location: `src/index.ts`
- Triggers: `bun run dev` / `bun run src/index.ts` (`package.json` scripts).
- Responsibilities: init logger → validate config → init Feishu WS → load state → register signal handlers → start heartbeat → keep alive.

**ReAct loop entry:**
- Location: `src/agent/react.ts:124` (`runAgentLoop`)
- Triggers: `runHeartbeat` in `src/index.ts`.
- Responsibilities: one wander cycle (max 10 steps by default).

**Web entry:**
- Location: `web/app/page.tsx` (dashboard), `web/app/layout.tsx` (root).
- Triggers: `cd web && bun run dev`.
- Responsibilities: read-only agent state visualization.

## Architectural Constraints

- **Threading:** Single-threaded Node/Bun event loop. No worker threads. Long-running operations (search, page fetch, LLM calls) are awaited sequentially inside `generateText` tool execution.
- **Global state / module-level singletons:** `src/agent/react.ts` (`_provider`, `_toolsInitialized`), `src/tools/tool-manager.ts` (`ToolManager.registry`, `enabledSet`, `initialized` static fields), `src/memory/long-term/index.ts` (`defaultStore`), `src/tools/push/lark-sender.ts` (`channel`), `src/tools/feishu/ws-client.ts` (`channel`, `connected`), `src/tui/index.tsx` (`currentState`, `currentLogs`, `renderInstance`), `src/llm/stats.ts` (`calls`, `currentCall`), `src/index.ts` (`heartbeatTimer`, `shuttingDown`). These assume a single long-lived process; test isolation requires `ToolManager.reset()` and `resetLLMStats()`.
- **Circular imports:** `src/logger.ts` dynamically imports `src/tui/index.js` and `src/logger/log-cleaner.js` inside `initLogger()` to break an import cycle. `src/logger/file-writer.ts` creates its own `consola` instance (commented "避免循环依赖").
- **Filesystem coupling:** The web app reads `../data/*` relative to its own cwd, so it must be launched from `web/` while data lives at repo root. No DB, no message broker.
- **Graceful shutdown:** 3s hard timeout in `src/index.ts:72`; all shutdown steps are awaited in order (heartbeat clear → Feishu WS close → state save → TUI unmount).
- **No planner:** Any change assuming a planner/decision step is wrong — use the ReAct tool-calling loop exclusively. `src/agent/planner.ts`, `src/agent/actions.ts`, `src/prompts/decision.ts`, `src/constants/decision.ts`, and `src/tools/filter/*` are deprecated.
- **Config immutability:** `config` is a frozen-at-import object; runtime changes to `data/agent-config.json` require a process restart.
- **Path assumptions:** Code uses `data/...` relative paths throughout (`src/config.ts:147` `getDataPath`, `src/memory/long-term/types.ts:54` `basePath: 'data/memory'`). Process must run from repo root.

## Anti-Patterns

### Silent fallbacks on push failure

**What happens:** `speak()` in `src/tools/push/speak.ts` catches every push-channel error, collects into `pushErrors`, and returns `{ success: true, pushed: false }` unless ALL channels fail. The ReAct loop treats this as a successful speak.
**Why it's wrong:** The LLM cannot distinguish "delivered" from "silently dropped"; telemetry undercounts real delivery. This conflicts with the project's CLAUDE.md "禁止随意使用兜底措施" rule.
**Do this instead:** When all configured channels fail, return `success: false` (already partly done) and surface the error to the LLM in the tool result so it can decide to retry or stop. For partial failures, return per-channel status instead of a single boolean.

### Deprecated legacy pipeline still imported

**What happens:** `src/types.ts:67` imports `ActionType` from `src/constants/decision.ts`; `src/llm/client.ts` imports `VALID_ACTIONS` for `callLLMForDecision`. These are marked `@deprecated` but still exported and type-coupled.
**Why it's wrong:** New contributors may reintroduce the planner pipeline; type churn in `AgentState.lastAction` references a dead enum.
**Do this instead:** Remove `src/agent/planner.ts`, `src/agent/actions.ts`, `src/prompts/decision.ts`, `src/constants/decision.ts`, `src/tools/filter/*` and the `lastAction`/`lastHunt*` fields from `AgentState`. Migrate `callLLMForDecision` consumers to the ReAct flow or delete it.

### Web dashboard reads files via relative path

**What happens:** `web/app/api/state/route.ts:11` does `readFile("../data/state.json")` and `web/app/api/history/route.ts` does `readdir("../data/history")`.
**Why it's wrong:** Breaks if the web app is built/served from a different cwd; no schema validation on the JSON; couples two processes through a shared filesystem assumption that is not enforced anywhere.
**Do this instead:** Resolve the data dir via an env var (`DATA_DIR=../data`) with a default, and validate the parsed JSON against a Zod schema before returning.

## Error Handling

**Strategy:** Catch at boundaries, log with context, propagate structured results to the LLM. Never let a tool throw out of `generateText`.

**Patterns:**
- Tool `execute` blocks wrap their body in try/catch and return `{ ..., error: String(error) }` instead of throwing (e.g. `src/tools/registry/search-web.ts:80`).
- `runAgentLoop` wraps `generateText` in try/catch and sets `ctx.endReason = 'error'` (`src/agent/react.ts:183`); the loop still completes and records stats.
- `runHeartbeat` wraps the whole body; heartbeat failure does not kill the scheduler (`src/index.ts:229`).
- File operations in memory/state use try/catch with logger.warn/error and fall back to defaults (`src/agent/state.ts:56`, `src/memory/user-profile.ts:52`).
- Graceful shutdown has a 3s `forceExitTimer` to avoid hanging on a stuck close (`src/index.ts:72`).

## Cross-Cutting Concerns

**Logging:** Custom `consola` instance (`src/logger.ts:49`) with a single `fileReporter` that writes synchronous lines to `data/logs/YYYY-MM-DD.log` via `writeLog` and fans out to `logCallbacks`. `src/logger/log-cleaner.ts` prunes logs older than 30 days (started lazily in `initLogger`). Tag pattern: `consola.withTag('module')` — tags appear in TUI and files.

**Validation:** Zod v4 schemas live inside tool definitions (`z.object({...})` in each `registry/*.ts`). `validateConfig()` (`src/config.ts:123`) gates required env vars at boot. `data/agent-config.json` is loaded with a `{...default, ...file}` merge (no schema validation).

**Authentication:** None in-app. External auth lives entirely in env vars: `DEEPSEEK_API_KEY` (LLM), `LARK_APP_ID`/`LARK_APP_SECRET` (Feishu bidirectional), `FEISHU_WEBHOOK`, `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`, `TAVILY_API_KEY`/`EXA_API_KEY` (search). Web dashboard has no auth.

**Trace IDs:** `src/logger/trace.ts` `generateTraceId()` prefixes every log line in a wander (`[${traceId}]`), enabling log correlation.

---

*Architecture analysis: 2026-06-20*
