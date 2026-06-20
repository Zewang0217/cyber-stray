# Technology Stack

**Analysis Date:** 2026-06-20

## Languages

**Primary:**
- TypeScript (strict mode) — All Agent source under `src/` (`tsconfig.json`, `target: ESNext`, `module: Preserve`, `verbatimModuleSyntax: true`)
- TSX/React — Terminal UI (`src/tui/*.tsx`) and Web Dashboard (`web/**/*.tsx`)

**Secondary:**
- JavaScript (.mjs/.cjs) — Tooling configs only: `web/postcss.config.mjs`, `web/eslint.config.mjs`, root `generate-ppt.cjs`

## Runtime

**Environment:**
- Bun (primary runtime for the Agent) — scripts in `package.json` run via `bun run` / `bun test`; `tsconfig.json` declares `"types": ["bun"]`
- Node.js (Next.js dev/build for the dashboard) — `web/package.json` uses `next dev` / `next build`

**Package Manager:**
- Bun — lockfile `bun.lock` (root, gitignored) and `web/bun.lock`
- npm — `package-lock.json` exists at root and under `web/` (legacy/secondary; `.gitignore` prefers `bun.lock`)
- Root `package.json` is `"private": true` with `"type": "module"`

## Frameworks

**Core:**
- Vercel AI SDK `ai@6` — Drives the ReAct loop (`src/agent/react.ts` uses `generateText` with `tools`, `stopWhen: [hasToolCall('rest'), stepCountIs(maxSteps)]`) and single-shot generation (`src/llm/client.ts`)
- `@ai-sdk/deepseek@^2.0.29` — DeepSeek provider (default `deepseek-chat` model)
- `@ai-sdk/openai@^3.0.53` — OpenAI-compatible provider (declared; DeepSeek is the active path)
- React `^19.2.5` + Ink `^7.0.1` — Terminal UI (`src/tui/App.tsx`, `src/tui/components/*`)
- Next.js `16.2.4` (App Router) — Web Dashboard under `web/app/`
- Tailwind CSS `^4` via `@tailwindcss/postcss` — Dashboard styling (`web/postcss.config.mjs`)

**Testing:**
- Bun test runner (`bun test`) — `*.test.ts` co-located under `src/` (e.g. `src/tools/search/duckduckgo.test.ts`, `src/tools/filter/scoring.test.ts`); imports from `bun:test`

**Build/Dev:**
- TypeScript `^5` with `tsc --noEmit` for typecheck (`bun run typecheck`)
- ESLint — root uses `eslint src/` (flat config not present at root, inheriting default); `web/eslint.config.mjs` uses `eslint-config-next`
- Next.js Turbopack (`web/next.config.ts` sets `turbopack.root`)

## Key Dependencies

**Critical (Agent):**
- `ai@6` — ReAct loop, tool definitions (`tool()`), `generateText` orchestration
- `@ai-sdk/deepseek@^2.0.29` — The active LLM provider (keyed by `DEEPSEEK_API_KEY`)
- `@larksuiteoapi/node-sdk@^1.62.1` — Feishu/Lark bidirectional integration: `createLarkChannel` for WebSocket event subscription (`src/tools/feishu/ws-client.ts`) and message sending (`src/tools/push/lark-sender.ts`)
- `zod@4` — All runtime validation: tool `inputSchema`, `callLLMForDecision` JSON schema, config types
- `ink@^7.0.1` + `react@^19.2.5` — TUI rendering host
- `jsdom@^29.0.2` + `@mozilla/readability@^0.6.0` — HTML fetch → article extraction (`src/tools/page/reader.ts`)
- `consola@^3.4.2` — Structured logging backbone (`src/logger.ts` defines a custom `fileReporter`)

**Critical (Web Dashboard):**
- `next@16.2.4`, `react@19.2.4`, `react-dom@19.2.4`
- `@react-three/fiber@^9.6.0` + `@react-three/drei@^10.7.7` + `@react-three/postprocessing@^3.0.4` + `postprocessing@^6.39.1` — 3D hero scene (`web/components/effects/HeroStage.tsx`)
- `framer-motion@^12.38.0` — Animations
- `tailwind-merge@^3.5.0` + `clsx@^2.1.1` — `web/lib/utils.ts` class composition
- `lucide-react@^1.8.0` — Icons
- `next-themes@^0.4.6` — Dark/light toggle

**Infrastructure / Utilities:**
- `pptxgenjs@^4.0.1` — Programmatic PPTX generation (used by root `generate-ppt.cjs`, not the Agent runtime)
- `react-devtools-core@^7.0.1` — Devtools integration for Ink

**Dev Dependencies:**
- `@types/bun`, `@types/react@^19`, `@types/react-dom@^19`, `@types/jsdom`, `@types/mozilla__readability`
- `typescript@^5`, `eslint@^9` (web), `eslint-config-next@16.2.4`, `@tailwindcss/postcss@^4`, `tailwindcss@^4`
- `@gltf-transform/cli@^4.3.0` — GLTF asset optimization for 3D models

## Configuration

**Environment (`.env` at repo root — gitignored, contents never read):**
- `DEEPSEEK_API_KEY` (required, validated in `src/config.ts validateConfig()`)
- `LLM_MODEL` (default `deepseek-chat`)
- `SEARCH_PROVIDER` (`duckduckgo` | `tavily` | `exa`; default `duckduckgo`)
- `TAVILY_API_KEY`, `EXA_API_KEY` (conditional — required only when their provider is selected)
- `FEISHU_WEBHOOK` (legacy outbound push; one of this or `TELEGRAM_BOT_TOKEN` is required)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (Telegram push)
- `LARK_APP_ID`, `LARK_APP_SECRET` (enable LarkChannel bidirectional + reaction feedback)
- `.env.example` exists at repo root (template; permission-restricted from reading here)

**Behavior Config — `data/agent-config.json` (committed, non-secret):**
- Heartbeat / energy / boredom thresholds, `energyRecoveryTiers` ladder
- `llmTemperature`, `wanderTemperature`, `maxWanderSteps`, `maxSearchResults`
- `urlCooldownDays`, `outputLanguage` (`zh-CN`)
- `feishu.pushMode` (`lark_channel` | `webhook`), `feishu.receiveMode` (`reaction` | `webhook` | `none`), `feishu.chatId`
- Loaded by `loadBehaviorConfig()` in `src/config.ts`; missing fields fall back to `defaultBehavior`

**Build / Type Config:**
- `tsconfig.json` (root) — `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`; excludes `web/` and `node_modules/`
- `web/tsconfig.json` — separate strict config with `@/*` path alias mapping to `web/*`, Next.js plugin
- `web/next.config.ts` — Turbopack root only
- `web/postcss.config.mjs` — Tailwind v4 PostCSS plugin

## Platform Requirements

**Development:**
- Bun installed (latest) for running/testing the Agent
- Node.js ≥ 20 (implied by `@types/node@^20` and Next.js 16) for the dashboard
- Environment variables in `.env` (Agent will `process.exit(1)` on missing required vars — see `src/index.ts` → `validateConfig()`)

**Production:**
- Agent: long-running Bun process; graceful shutdown via SIGINT/SIGTERM handlers in `src/index.ts` (clears heartbeat timer, closes Feishu WebSocket, saves state, shuts down TUI)
- Web Dashboard: Next.js production build (`next build` + `next start`); reads Agent state from `../data/state.json` and `../data/history/*.json` via `web/app/api/*/route.ts` (relative filesystem reads — dashboard must run from `web/` with the Agent's `data/` as sibling)

---

*Stack analysis: 2026-06-20*
