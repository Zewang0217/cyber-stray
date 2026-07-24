# Codebase Structure

**Analysis Date:** 2026-06-20

## Directory Layout

```
cyber-stray/
├── src/                      # Agent source (TypeScript, Bun runtime)
│   ├── index.ts              # Process entry — main(), heartbeat, signal handlers
│   ├── config.ts             # AgentConfig loader (data/agent-config.json + env)
│   ├── types.ts              # Shared interfaces (AgentState, AgentConfig, etc.)
│   ├── logger.ts             # consola instance + onLog callback registry
│   ├── agent/                # ReAct loop + state machine
│   │   ├── react.ts          # runAgentLoop (LIVE)
│   │   ├── state.ts          # loadState/saveState/heartbeat (LIVE)
│   │   ├── planner.ts        # @deprecated legacy decision pipeline
│   │   └── actions.ts        # @deprecated legacy hunt executor
│   ├── constants/
│   │   └── decision.ts       # @deprecated VALID_ACTIONS enum
│   ├── llm/                  # DeepSeek provider wrappers
│   │   ├── client.ts         # callLLM / callLLMForDecision
│   │   └── stats.ts          # LLM call timing (reset per wander)
│   ├── logger/               # File logging infrastructure
│   │   ├── file-writer.ts    # Sync write to data/logs/YYYY-MM-DD.log
│   │   ├── log-cleaner.ts    # 30-day retention pruner
│   │   └── trace.ts          # generateTraceId()
│   ├── memory/               # Three-tier memory system
│   │   ├── user-profile.ts   # UserProfile JSON + cooldown-gated writes
│   │   ├── feedback-store.ts # data/feedback.json CRUD
│   │   ├── long-term.ts      # Barrel re-export of long-term/*
│   │   └── long-term/        # MemoryStore (Markdown file repository)
│   │       ├── index.ts      # MemoryStore class + getMemoryStore()
│   │       ├── read.ts       # Read helpers + buildMemoryPromptContext
│   │       ├── write.ts      # recordInteraction/Knowledge/Observation/...
│   │       ├── consolidate.ts# MemoryConsolidator (capacity mgmt)
│   │       └── types.ts      # MemoryEntry, MemoryType, frontmatter parsers
│   ├── prompts/              # LLM prompt builders
│   │   ├── react.ts          # buildReactSystemPrompt/UserPrompt (LIVE)
│   │   ├── content.ts        # Push content generation prompts
│   │   └── decision.ts       # @deprecated legacy decision prompts
│   ├── tools/                # Tool layer (AI SDK tools)
│   │   ├── tool-manager.ts   # ToolManager registry singleton
│   │   ├── tool-prompt.ts    # Tool metadata → prompt text
│   │   ├── registry/         # Tool definitions (1 file per tool)
│   │   │   ├── auto-register.ts  # registerAllTools() — ADD NEW TOOLS HERE
│   │   │   ├── context.ts    # ToolContext (mutable per-wander scratchpad)
│   │   │   ├── index.ts      # Barrel: re-exports ToolManager + createTools
│   │   │   ├── search-web.ts
│   │   │   ├── read-page.ts
│   │   │   ├── speak.ts
│   │   │   ├── rest.ts
│   │   │   ├── record-knowledge.ts
│   │   │   ├── observe-user.ts
│   │   │   ├── read-feedback.ts
│   │   │   └── _template.ts  # Copy-paste template for new tools
│   │   ├── search/           # SearchAdapter implementations
│   │   │   ├── adapter.ts    # SearchAdapter interface
│   │   │   ├── index.ts      # Provider selection + premiumSearch
│   │   │   ├── duckduckgo.ts # Free default
│   │   │   ├── tavily.ts     # Premium
│   │   │   └── exa.ts        # Premium (Neural)
│   │   ├── page/
│   │   │   └── reader.ts     # JSDOM + Readability page extractor
│   │   ├── push/             # Multi-channel push
│   │   │   ├── speak.ts      # Push orchestrator + history logger
│   │   │   ├── lark-sender.ts# Feishu LarkChannel + Webhook sender
│   │   │   └── feishu-card.ts# Card payload builder
│   │   ├── feishu/
│   │   │   └── ws-client.ts  # Incoming emoji feedback (WebSocket)
│   │   ├── dedup/
│   │   │   └── url-tracker.ts# Cross-wander URL cooldown
│   │   ├── filter/           # @deprecated (LLM decides now)
│   │   │   ├── index.ts
│   │   │   ├── dedup.ts
│   │   │   ├── scoring.ts
│   │   │   └── history.ts
│   │   └── content/
│   │       └── generator.ts  # @deprecated push content generation
│   └── tui/                  # Ink (React for terminal) UI
│       ├── index.tsx         # render() + fallback text mode
│       ├── App.tsx           # Root component
│       └── components/       # StatusBar, LogView, Loading, ErrorBoundary
│
├── web/                      # Separate Next.js 16 dashboard app
│   ├── app/
│   │   ├── page.tsx          # Dashboard home
│   │   ├── layout.tsx        # Root layout (fonts, sidebar, effects)
│   │   ├── providers.tsx     # next-themes provider
│   │   ├── globals.css       # Tailwind 4 + Catppuccin theme tokens
│   │   ├── history/          # Push history page
│   │   ├── settings/         # Settings page
│   │   └── api/              # Next.js Route Handlers (read ../data/*)
│   │       ├── state/route.ts
│   │       └── history/route.ts
│   ├── components/
│   │   ├── dashboard/        # StatCard, MoodBadge, CircularGauge
│   │   ├── ui/               # GlassCard, FeedCard, TypewriterText, MagneticButton
│   │   ├── effects/          # CyberGridBackground, HeroStage, RadarScan, MouseGlow, PulseBorder
│   │   └── layout/           # Sidebar, ThemeToggle
│   ├── hooks/
│   │   ├── useAgentState.ts  # Polls /api/state every 5s
│   │   └── useHistory.ts
│   ├── lib/
│   │   ├── types.ts          # Web-side shared types
│   │   └── utils.ts          # cn() classname merge
│   ├── package.json          # Next 16, React 19, Framer Motion, Three.js
│   └── tsconfig.json
│
├── data/                     # Runtime state (gitignored except config)
│   ├── agent-config.json     # Behavior params (COMMITTED)
│   ├── state.json            # AgentState (gitignored)
│   ├── wander-history.json   # Last 100 wander steps (gitignored)
│   ├── feedback.json         # User feedback queue (gitignored)
│   ├── history/              # speaks-YYYY-MM-DD.jsonl push logs
│   ├── logs/                 # YYYY-MM-DD.log daily logs
│   ├── dedup/
│   │   └── visited-urls.json # URL cooldown store
│   └── memory/               # Long-term memory (Markdown)
│       ├── INDEX.md          # Aggregate index
│       ├── user-profile.json # UserProfile
│       ├── knowledge/        # knowledge-*.md
│       ├── interactions/     # interaction-*.md
│       └── observations/     # (observation type)
│
├── docs/                     # Documentation
├── assets/                   # Static assets
├── slides/                   # Slidev presentation (separate subproject)
├── .planning/codebase/       # GSD codebase maps (this file)
├── .agents/skills/           # Agent skills
├── package.json              # Root: Bun + AI SDK + Ink + Zod
├── tsconfig.json             # Strict TS, excludes web/
├── CLAUDE.md                 # Agent instructions
├── DESIGN.md                 # Catppuccin visual spec
└── README.md
```

## Directory Purposes

**`src/`:**
- Purpose: All Agent runtime code.
- Contains: TypeScript modules (strict mode, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`).
- Key files: `src/index.ts`, `src/agent/react.ts`, `src/tools/tool-manager.ts`.

**`src/tools/registry/`:**
- Purpose: One file per AI SDK tool definition.
- Contains: `*ToolDef` exports + `auto-register.ts` aggregator.
- Key files: `auto-register.ts` (edit when adding tools), `context.ts` (ToolContext shape), `_template.ts` (copy for new tools).

**`src/memory/long-term/`:**
- Purpose: File-based Markdown memory repository.
- Contains: `MemoryStore` class split across `index.ts`/`read.ts`/`write.ts`/`consolidate.ts`/`types.ts`.
- Key files: `index.ts` (class), `types.ts` (frontmatter parsers + safe filename logic).

**`web/`:**
- Purpose: Standalone Next.js 16 dashboard. Independent `package.json`, `tsconfig.json`, `bun.lock`.
- Contains: App Router pages, API route handlers, React components, hooks.
- Key files: `app/page.tsx`, `app/api/state/route.ts`, `hooks/useAgentState.ts`.

**`data/`:**
- Purpose: Single source of truth at runtime. The agent writes here; the web app reads from here.
- Contains: JSON state, Markdown memory, JSONL push logs, daily log files.
- Key files: `data/agent-config.json` (committed), `data/state.json` (gitignored).

**`slides/`:**
- Purpose: Separate Slidev presentation subproject with its own `package.json` and `node_modules`. Unrelated to agent runtime.

## Key File Locations

**Entry Points:**
- `src/index.ts`: Agent process entry (`bun run dev`).
- `web/app/page.tsx`: Dashboard entry (`cd web && bun run dev`).
- `slides/`: Presentation entry (Slidev).

**Configuration:**
- `src/config.ts`: `AgentConfig` assembly (behavior + secrets).
- `data/agent-config.json`: Tunable behavior params (committed; has `_note` keys documenting each field).
- `tsconfig.json`: Root TS config (strict, excludes `web/`).
- `web/tsconfig.json`: Web-specific TS config.
- `package.json` (root + `web/` + `slides/`): Three independent package manifests.

**Core Logic:**
- `src/agent/react.ts`: `runAgentLoop` — the live decision loop.
- `src/agent/state.ts`: State machine + persistence.
- `src/tools/tool-manager.ts`: Tool registry.
- `src/memory/long-term/index.ts`: `MemoryStore`.

**Testing:**
- `src/tools/search/{duckduckgo,tavily,exa}.test.ts`: Search adapter tests.
- `src/tools/filter/{dedup,scoring}.test.ts`: Legacy filter tests.
- `src/tools/content/generator.test.ts`: Content generator test.
- Runner: `bun test` (Bun's built-in test runner, no separate config).

## Naming Conventions

**Files:**
- `kebab-case.ts` for modules: `tool-manager.ts`, `url-tracker.ts`, `file-writer.ts`.
- `kebab-case.test.ts` co-located with source: `duckduckgo.test.ts` next to `duckduckgo.ts`.
- `PascalCase.tsx` for React components: `App.tsx`, `StatusBar.tsx`, `CircularGauge.tsx`.
- Tool definition files match the tool name: `search-web.ts` → tool `search_web`.
- Barrel files: `index.ts` (or `index.tsx`) at directory root re-export public API (e.g. `src/memory/long-term.ts`, `src/tools/search/index.ts`).

**Directories:**
- `kebab-case` throughout: `long-term`, `auto-register` via file, `url-tracker`.
- Tool category directories match `ToolMetadata.category`: `search`, `page`, `push`, `memory` (under `tools/`), `content`, `filter`, `dedup`.

**Exports:**
- Tool definitions: `const searchWebToolDef: ToolDefinition` (camelCase variable, `ToolDef` suffix).
- Backward-compat aliases: `export const createSearchWebTool = (ctx) => searchWebToolDef.createTool(ctx)`.
- Functions: `camelCase` (`runAgentLoop`, `buildMemoryPromptContext`, `getRecoveryTier`).
- Types/Interfaces: `PascalCase` (`AgentState`, `ToolContext`, `MemoryEntry`).
- Constants: `UPPER_SNAKE_CASE` (`MAX_WANDER_HISTORY_ENTRIES`, `ENERGY_COST_PER_STEP`, `DEFAULT_MEMORY_CONFIG`).

## Where to Add New Code

**New LLM tool:**
1. Copy `src/tools/registry/_template.ts` to `src/tools/registry/<tool-name>.ts`.
2. Export a `<name>ToolDef: ToolDefinition` with `metadata` (name/description/category) and `createTool(ctx)`.
3. Import it in `src/tools/registry/auto-register.ts` and append to `TOOL_DEFINITIONS`.
4. Use `pushWanderStep(ctx, {...})` to record in wander history; increment `ctx.stepCount` at the start of `execute`.
5. Add Zod `inputSchema` for LLM-visible parameters.

**New search adapter:**
1. Create `src/tools/search/<provider>.ts` implementing `SearchAdapter` (`search`, `getName`, `isAvailable`).
2. Register it in `src/tools/search/index.ts` `adapters` Map (gated on its API key from `config`).
3. Add the provider name to the `adapter` union in `search()`'s options type.

**New memory type:**
1. Add the type to `MemoryType` in `src/memory/long-term/types.ts`.
2. Add its subdirectory to `MEMORY_TYPE_PATHS`.
3. Extend `MemoryStore.groupByType`, `getTypeLabel`, and `createDefaultIndex` defaults.
4. Add a write helper in `src/memory/long-term/write.ts` and re-export from `src/memory/long-term.ts`.

**New push channel:**
1. Add config fields to `AgentConfig` in `src/types.ts` and `config` in `src/config.ts` (env-driven).
2. Add a `pushTo<Channel>` function in `src/tools/push/speak.ts` following the `pushToTelegram` pattern (fetch + timeout + error collection).
3. Wire it into the `speak()` multi-channel dispatch.

**New dashboard page:**
1. Add `web/app/<route>/page.tsx` (App Router).
2. Add a nav entry to `navItems` in `web/components/layout/Sidebar.tsx`.
3. If it needs agent data, add a route handler in `web/app/api/<name>/route.ts` reading from `../data/`.
4. Add a hook in `web/hooks/use<Name>.ts` mirroring `useAgentState`'s polling pattern.

**New shared type (agent):**
- Add to `src/types.ts` and import via relative path with `.js` extension (`verbatimModuleSyntax` requires this even for TS sources).

**New shared type (web):**
- Add to `web/lib/types.ts` and import via `@/lib/types` (`@/*` path alias configured in `web/tsconfig.json`).

**Utilities:**
- Agent-side shared helpers: inline in the relevant module or create `src/<area>/<helper>.ts`. No central `utils.ts` exists for the agent.
- Web-side: `web/lib/utils.ts` (currently just `cn()` for classname merging).

## Special Directories

**`data/`:**
- Purpose: Runtime persistence (state, memory, logs, history, dedup).
- Generated: Yes, by the agent at runtime.
- Committed: Partially. `data/agent-config.json` is committed; `data/state.json`, `data/history/*`, `data/memory/**/*.md`, `data/wander-history.json`, `data/feedback.json`, `*.log` are gitignored. `data/memory/.gitkeep` and `data/memory/INDEX.md` may be committed as scaffolding.

**`.next/` (web):**
- Purpose: Next.js build output.
- Generated: Yes, by `next build`.
- Committed: No (gitignored).

**`node_modules/`:**
- Purpose: Dependencies. Three separate trees: root, `web/node_modules`, `slides/node_modules`.
- Generated: Yes, by `bun install`.
- Committed: No.

**`slides/`:**
- Purpose: Standalone Slidev presentation project (unrelated to agent runtime). Has own `package.json` and `node_modules`.

**`.planning/codebase/`:**
- Purpose: GSD codebase map documents (this file, ARCHITECTURE.md, etc.).
- Generated: By `/gsd-map-codebase`.
- Committed: Yes (intended reference for planning).

**`.agents/skills/` and `.claude/`:**
- Purpose: Agent skill definitions and Claude Code config.
- Generated: Partially (some committed, `.agents/` is gitignored per `.gitignore`).

---

*Structure analysis: 2026-06-20*
