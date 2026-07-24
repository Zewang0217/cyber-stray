# Coding Conventions

**Analysis Date:** 2026-06-20

This codebase is a Bun/TypeScript autonomous agent ("Cyber Stray") with two surfaces:

1. **Agent core** — `src/` (Bun runtime, Vercel AI SDK, Ink TUI)
2. **Web dashboard** — `web/` (Next.js 16, React 19, Tailwind 4, Framer Motion)

Both are TypeScript `strict: true`. They share a near-identical type model but use different import conventions (see below). Comments, identifiers in domain code, docstrings, and log messages are predominantly **Chinese**; code identifiers (variable/function/type names) are **English**.

## Naming Patterns

**Files:**
- `kebab-case.ts` / `kebab-case.tsx` everywhere — e.g. `src/agent/react.ts`, `src/tools/search/duckduckgo.ts`, `web/components/effects/PulseBorder.tsx`.
- One concept per file; co-located tests share the stem: `scoring.ts` + `scoring.test.ts`, `dedup.ts` + `dedup.test.ts`.
- Module barrels are `index.ts` and only re-export: `src/tools/search/index.ts`, `src/memory/long-term/index.ts`.
- React components: `PascalCase.tsx` matching the exported component name (`GlassCard.tsx` exports `GlassCard`).
- Tool registry files are lowercase matching the tool's LLM-visible name: `search-web.ts` → tool `search_web`, `read-page.ts` → tool `read_page`, `speak.ts` → tool `speak`, `rest.ts` → tool `rest`.

**Functions:**
- `camelCase` — `loadState()`, `getRecoveryTier()`, `calculateScore()`, `dedupByUrl()`, `generatePushContent()`, `runAgentLoop()`.
- Async functions return `Promise<T>` and are named for their action, not prefixed with `async`.
- Factory functions that produce an AI SDK tool: `createXxxTool(ctx)` — see template at `src/tools/registry/_template.ts:18`.
- Pure helpers take primitive/array args and have no side effects (`getUrlHash`, `normalizeUrl`, `toSafeFilename`).

**Variables:**
- `camelCase` locals, `PascalCase` for types/interfaces/components.
- Module-level singletons use a leading underscore convention: `_provider`, `_toolsInitialized`, `deepseekProvider`, `defaultStore` — lazily initialized via a `getX()` accessor (`src/agent/react.ts:38-45`, `src/llm/client.ts:25-32`, `src/memory/long-term/index.ts:544-551`).
- Constants are `UPPER_SNAKE_CASE` and declared `const` at module top: `MAX_CONTENT_LENGTH`, `FETCH_TIMEOUT_MS`, `DEFAULT_MESSAGE`, `MAX_WANDER_HISTORY_ENTRIES`, `CONTENT_TEMPERATURE`.

**Types:**
- Domain types live in `src/types.ts` (agent) and `web/lib/types.ts` (dashboard). Keep them in sync — `web/lib/types.ts` mirrors `src/types.ts`.
- `interface` for object shapes (`AgentState`, `SearchResult`, `PushContent`, `ToolContext`, `WanderResult`).
- `type` for unions and aliases (`Mood`, `HuntResult`, `ActionType`, `LogLevel`, `MemoryType`).
- String-literal unions preferred over enums: `export type Mood = 'curious' | 'grumpy' | ...` (`src/types.ts:10`). The only `as const` array pattern is `VALID_ACTIONS` in `src/constants/decision.ts:13`.
- Branded result types extend their input: `interface ScoringResult extends SearchResult { score: number; reason: string }` (`src/tools/filter/scoring.ts:14`).
- Input options use a named optional object: `search(query, options?: SearchOptions)` (`src/tools/search/adapter.ts:5`).

**React components (web + TUI):**
- Function components, declared `export function Component(props): React.ReactElement`.
- Props interface named `<Component>Props` directly above the component (`GlassCardProps`, `StatCardProps`, `StatusBarProps`).
- `"use client";` directive at the top of every client component (`web/app/page.tsx:1`, `web/components/ui/GlassCard.tsx:1`).
- Ink (TUI) components likewise: `src/tui/components/StatusBar.tsx`, `src/tui/App.tsx`.

## Code Style

**Formatting:**
- No Prettier / Biome config in the repo. Style is enforced by ESLint only.
- Indentation: **2 spaces** in `src/` (agent) and `web/` components/hooks; **4 spaces** in some newer `web/app/page.tsx` JSX. Follow the surrounding file's indentation when editing.
- Strings: **single quotes** in `src/` (`'bun:test'`, `'./duckduckgo.js'`); **double quotes** in `web/` (`"@/lib/types"`). Match each surface's convention.
- Semicolons: always.
- Trailing commas in multi-line objects/arrays: yes.
- Arrow functions for short helpers; `function` for exported API and module-level helpers.

**Linting:**
- Agent core: `bun run lint` runs `eslint src/` (no flat config in repo root — relies on default ESLint resolution; `tsconfig.json` is excluded from `web`).
- Web: `web/eslint.config.mjs` uses `eslint-config-next` (core-web-vitals + typescript). One override: `"react-hooks/set-state-in-effect": "off"` to allow typewriter/animation effects to initialize state in `useEffect` (`web/eslint.config.mjs:9-13`).
- TypeScript `strict: true` in both `tsconfig.json` files. Agent also enables `noUncheckedIndexedAccess` and `noImplicitOverride` (`tsconfig.json:21-23`) — array access returns `T | undefined`, so tests use `results[0]!` after a length check (see `src/tools/search/duckduckgo.test.ts:40`).

**TypeScript configuration highlights (`src/`):**
- `"module": "Preserve"`, `"verbatimModuleSyntax": true` — this is why imports carry `.js` extensions and why `import type` is mandatory for type-only imports.
- `"target": "ESNext"`, `"lib": ["ESNext", "DOM", "DOM.Iterable"]`.

## Import Organization

**Order (observed in every source file):**
1. External packages (`'ai'`, `'zod'`, `'react'`, `'ink'`, `'fs/promises'`, `'consola'`).
2. Internal absolute-ish modules (`'../config.js'`, `'../../logger.js'`, `'../../types.js'`).
3. Local sibling modules (`'./duckduckgo.js'`, `'./context.js'`).
4. Type-only imports come last with `import type { ... }`.

**Extension rules — CRITICAL:**
- **Agent (`src/`):** relative imports **MUST use `.js` extension** even for `.ts` files (`import { consola } from '../../logger.js'`). This is required by `verbatimModuleSyntax: true` + Bun's ESM resolution. 146 such imports found; only a handful of legacy files (`src/agent/state.ts`, `src/memory/long-term/index.ts` imports) omit the extension — treat those as tech debt, do not copy.
- **Web (`web/`):** use the `@/` path alias with **no extension** (`import { useAgentState } from "@/hooks/useAgentState"`, `import { cn } from "@/lib/utils"`). Configured via `web/tsconfig.json` `paths: { "@/*": ["./*"] }`.

**Path Aliases:**
- `src/`: none — all imports are relative (`../`, `../../`).
- `web/`: `@/*` → repo-root-relative from `web/` (e.g. `@/lib/types`, `@/components/ui/GlassCard`).

**Type-only imports:** always use `import type` for interfaces/types — enforced by `verbatimModuleSyntax`. Re-exporting types: `export type { ToolContext } from './context.js'` (`src/tools/registry/index.ts:15`).

## Error Handling

**Overall strategy: distinguish "crash the process" from "degrade one operation".**

- **Process-fatal errors → `throw new Error(...)` with a descriptive Chinese message.**
  - Missing required env vars: `validateConfig()` throws `缺少必要环境变量: ...` (`src/config.ts:123-141`); `src/index.ts:28-31` catches and `process.exit(1)`.
  - Missing API key for provider: `createDeepSeekProvider()` throws `缺少环境变量 DEEPSEEK_API_KEY` (`src/llm/client.ts:17-19`, `src/agent/react.ts:31-33`).
  - Search adapter HTTP failure: `throw new Error(`DuckDuckGo API 返回 ${response.status}: ${response.statusText}`)` (`src/tools/search/duckduckgo.ts:30`).

- **Non-fatal operation failures → log + return a structured result with `error` field, do NOT throw.**
  - `readPage()` catches fetch/parse errors and returns `PageResult` with `error: string` populated (`src/tools/page/reader.ts:88-166`).
  - `speak()` collects per-channel errors into `pushErrors[]`, still returns `SpeakResult` with `success: true, pushed: false, error: ...` so the ReAct loop continues (`src/tools/push/speak.ts:95-184`).
  - `generatePushContent()` catches LLM failure and falls back to `DEFAULT_MESSAGE` (`src/tools/content/generator.ts:53-56`).
  - Search layer returns `[]` on adapter failure with an `error` log (`src/tools/search/index.ts:67-74`).

- **`error instanceof Error ? error.message : String(error)`** is the canonical way to normalize caught values into a string — used in `src/index.ts`, `src/tools/push/speak.ts`, `src/tools/page/reader.ts`, `web/app/api/state/route.ts`. Follow this pattern.

- **Promise rejection in fire-and-forget paths:** append `.catch((err: unknown) => logger.warn(...))` so the error is logged but does not abort the calling `await`. See `src/agent/react.ts:211-232` (`speak(...).catch(...)`, `recordWanderSummary(...).catch(...)`).

- **No silent catches.** Every `catch` either re-throws, logs at `warn`/`error`, or returns a clearly-marked error result. An empty `catch {}` only appears for deliberately-skippable parsing of corrupted files (`web/app/api/history/route.ts:24` — explicitly commented `// 跳过损坏的文件`).

- **CLAUDE.md project rule:** "禁止随意使用兜底措施" — do NOT paper over failures with default/inferred values that hide the error from callers. Only fall back when the fallback itself is a legitimate product behavior (e.g. `DEFAULT_MESSAGE` is an intentional fallback message, not silent error masking).

## Logging

**Framework:** `consola` (v3.4+) wrapped in `src/logger.ts`.

- **One shared instance:** `export const consola` created in `src/logger.ts:49`, then per-module tagged child: `const logger = consola.withTag('duckduckgo')`.
- Every non-trivial module declares its own tagged logger at the top — `search`, `filter-dedup`, `filter-scoring`, `content`, `speak`, `page-reader`, `react`, `llm`, `MemoryStore`, `tool:search_web`, `tool:speak`, `tool:rest`, etc.
- File output: a custom `fileReporter` writes every log line to `data/logs/YYYY-MM-DD.log` via synchronous `writeFileSync` (`src/logger/file-writer.ts:84-98`). Format: `[YYYY-MM-DD HH:mm:ss] [LEVEL] message {key=value ...}`.
- TUI consumes the same stream through `onLog()` callbacks (`src/logger.ts:17-19`) — the agent's terminal UI and file log are fed from one source.
- `console.log` / `console.warn` are used sparingly in `src/index.ts` (pre-TUI-boot messages) and inside `ToolManager` (`console.log` / `console.warn` in `src/tools/tool-manager.ts:46,192`). Prefer the tagged `logger` over raw `console`.

**Level discipline (matches CLAUDE.md):**
- `logger.debug` — internal detail (prompt lengths, parsed fields, intermediate state). Example: `logger.debug('调用 LLM', { model, temperature, ... })` (`src/llm/client.ts:47`).
- `logger.info` — key checkpoints and business milestones: `心跳触发`, `游荡开始`, `speak 调用`, `请求 DuckDuckGo API`, `配置验证通过`.
- `logger.success` — completed operations with counts: `搜索完成`, `文案生成完成`, `网页读取完成`.
- `logger.warn` — recoverable degradation: `LLM 返回空文案，使用默认文案`, `适配器 X 不可用，回退到 DuckDuckGo`.
- `logger.error` — failed operations that need attention: `LLM 调用异常`, `写入记忆文件失败`, `心跳执行失败`.

**Structured logging payload:** pass a plain object as the second arg — `logger.info('请求 DuckDuckGo API', { query })`. Never template values into the message string for structured data; use `{ key: value }`. For trace-correlated logs, prefix the message with `[${ctx.traceId}]` (`src/agent/react.ts:132`, `src/tools/registry/search-web.ts:63`).

**CLAUDE.md rule:** no secrets (API keys, tokens, full phone numbers) in logs. Sensitive values come from `process.env` and are never logged.

## Comments

**When to Comment:**
- Every exported function/class/interface has a Chinese JSDoc block describing purpose, params, and return value. Example: `src/config.ts:106-118`, `src/agent/state.ts:113-139`, `src/tools/push/speak.ts:95-94`.
- Section dividers in larger type files: `// ============================================\n// 状态相关\n// ============================================` (`src/types.ts:7`).
- Inline comments explain **why**, not what: `// 精力低于阈值时，暂停无聊值增长（让精力自然恢复）` (`src/agent/state.ts:120`).
- Mark legacy code with `@deprecated` + explanation of the replacement: `src/tools/filter/scoring.ts:1-8`, `src/tools/registry/index.ts:5-6`, `src/types.ts:29-50`.

**JSDoc/TSDoc pattern:**
```typescript
/**
 * 心跳：更新无聊值和精力值
 *
 * @param boredomGrowth - 无聊值增长率
 * @param energyRecovery - 精力恢复率
 * @param energyRecoveringThreshold - 精力恢复阈值，低于此值时暂停无聊值增长
 */
```
(`src/agent/state.ts:111-116`)

**Language:** Chinese for all comments, docstrings, and log messages. English only for identifiers and external API field names.

## Function Design

**Size:** CLAUDE.md enforces **methods ≤ 40 lines, modules ≤ 300 lines**. Most functions are well under this. Notable overages that are flagged tech debt:
- `src/memory/long-term/index.ts` is **551 lines** (the `MemoryStore` class itself) — exceeds the 300-line module limit.
- `web/app/page.tsx` is **405 lines** — large single component, candidate for extraction.
- `runAgentLoop` in `src/agent/react.ts` is ~130 lines — large but cohesive; has inline extracted helpers (`extractRecentTopics`, `appendWanderHistory`).

**Parameters:**
- ≤3 positional params preferred. For more, or for optional config, use a typed options object: `search(query, options?: SearchOptions & { adapter?: ... })`.
- Optional params use defaults at the top of the function body, not destructuring-with-defaults in the signature: `export async function heartbeat(boredomGrowth, energyRecovery, energyRecoveringThreshold = 30)` (`src/agent/state.ts:113`).

**Return Values:**
- Always typed `Promise<T>` with an explicit interface — never `Promise<any>` or implicit.
- Result shapes that can fail carry an optional `error?: string` field rather than throwing (`PageResult`, `SpeakResult`).
- Pure functions return new values, never mutate arguments (`calculateScore`, `dedupByUrl`, `getUrlHash`).

**Guard clauses (CLAUDE.md "Anti-Nesting" rule):** use early returns, max 2 levels of indentation. Reference pattern from `src/index.ts:62-67`:
```typescript
const handleSignal = async (signal: string): Promise<void> => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  // ... main body
};
```

## Module Design

**Exports:**
- Named exports only — **no default exports** except Next.js pages/routes (`export default function DashboardPage()` in `web/app/page.tsx:23`, `export async function GET()` in `web/app/api/state/route.ts:9`) where the framework requires it.
- One primary export per module where possible (`runAgentLoop`, `generatePushContent`, `readPage`, `speak`).

**Barrel Files:**
- `src/tools/search/index.ts` — re-exports adapter classes + the `search`/`premiumSearch` functions and adapter types.
- `src/memory/long-term/index.ts` — aggregates the long-term memory store and sub-modules (`read`, `write`, `consolidate`, `types`).
- `src/tools/registry/index.ts` — compatibility layer re-exporting `ToolManager` + `createTools(ctx)` (the latter marked `@deprecated`).

**Compatibility aliases:** legacy factory functions are kept as thin wrappers and marked deprecated:
```typescript
/** 向后兼容别名 */
export const createSearchWebTool = (ctx: ToolContext) => searchWebToolDef.createTool(ctx);
```
(`src/tools/registry/search-web.ts:90`, also in `speak.ts:69`, `rest.ts:43`)

**Singleton initialization pattern (lazy + cached):**
```typescript
let _provider: ReturnType<typeof createProvider> | null = null;
function getProvider() {
  if (!_provider) {
    _provider = createProvider();
  }
  return _provider;
}
```
Used for the DeepSeek provider (`src/agent/react.ts:38-45`, `src/llm/client.ts:25-32`) and the default `MemoryStore` (`src/memory/long-term/index.ts:544-551`). `ToolManager` uses a static class with `initialized` flag + `reset()` for testability (`src/tools/tool-manager.ts:36-209`).

**Tool registration pattern (new tools):**
1. Create `src/tools/registry/<tool-name>.ts`.
2. Export a `ToolDefinition` object with `metadata: { name, description, category }` and `createTool(ctx)`.
3. Register in `src/tools/registry/auto-register.ts` by adding to the `TOOL_DEFINITIONS` array.
4. See `src/tools/registry/_template.ts` for the canonical template.

---

*Convention analysis: 2026-06-20*
