# External Integrations

**Analysis Date:** 2026-06-20

## APIs & External Services

**LLM (DeepSeek):**
- DeepSeek chat completions — primary reasoning engine for the ReAct loop and decision-making
  - SDK/Client: `@ai-sdk/deepseek` `createDeepSeek({ apiKey })`, consumed via `ai` SDK `generateText` (`src/llm/client.ts`, `src/agent/react.ts`)
  - Model: `process.env.LLM_MODEL || 'deepseek-chat'` (read in `src/config.ts`)
  - Auth: `DEEPSEEK_API_KEY` (required; missing key throws in `createDeepSeekProvider()` and fails `validateConfig()`)

**Web Search:**
- DuckDuckGo Instant Answer API — default free adapter (`src/tools/search/duckduckgo.ts`, `GET https://api.duckduckgo.com/`, no auth, 10s timeout)
- Tavily Search API — premium/news adapter (`src/tools/search/tavily.ts`, `POST https://api.tavily.com/search`, `Authorization: Bearer <key>`, 15s timeout)
  - SDK/Client: raw `fetch` (no SDK)
  - Auth: `TAVILY_API_KEY`
- Exa Neural Search API — premium adapter with content extraction (`src/tools/search/exa.ts`, `POST https://api.exa.ai/search`, `x-api-key` header, 15s timeout)
  - Auth: `EXA_API_KEY`
- Provider selection: `config.searchProvider` (env `SEARCH_PROVIDER`, default `duckduckgo`); adapter registry in `src/tools/search/index.ts` falls back to DuckDuckGo if the configured adapter is unavailable. `premiumSearch()` tries Exa first, degrades to Tavily.

**Web Page Fetch (readability extraction):**
- Arbitrary public web pages — `src/tools/page/reader.ts` uses global `fetch()` with a custom `User-Agent: Mozilla/5.0 (compatible; CyberStrayBot/1.0)`, then parses with `jsdom` + `@mozilla/readability`
- No auth; 15s timeout; returns up to 5000 chars of cleaned text + up to 10 links per page

**Feishu / Lark (飞书) — Primary push + feedback channel:**
- Outbound messages via LarkChannel (default) — `src/tools/push/lark-sender.ts` uses `@larksuiteoapi/node-sdk` `createLarkChannel({ appId, appSecret })`, sends markdown to `config.feishu.chatId`
- Outbound via legacy Webhook (fallback) — `POST` JSON body to `config.feishuWebhook`, supports card (`buildFeedbackCard()` in `src/tools/push/feishu-card.ts`) and plain text formats
- Inbound events via LarkChannel WebSocket — `src/tools/feishu/ws-client.ts` subscribes to `reaction` events; 👍 `thumbs_up` → `like`, 👎 `thumbs_down` → `dislike`; recorded via `recordFeedback()` and reflected into `updateMoodByFeedback()`
- Auth: `LARK_APP_ID` + `LARK_APP_SECRET` (LarkChannel), `FEISHU_WEBHOOK` (legacy)
- Mode selection: `data/agent-config.json` `feishu.pushMode` (`lark_channel` default | `webhook`) and `feishu.receiveMode` (`reaction` default | `webhook` | `none`)

**Telegram Bot:**
- Telegram Bot API sendMessage — `src/tools/push/speak.ts pushToTelegram()`, `POST https://api.telegram.org/bot<token>/sendMessage`, `parse_mode: 'HTML'`, 10s timeout
- Auth: `TELEGRAM_BOT_TOKEN`, target chat: `TELEGRAM_CHAT_ID`

**Web Dashboard (Next.js, internal):**
- `GET /api/state` — `web/app/api/state/route.ts` reads `../data/state.json` from disk
- `GET /api/history` — `web/app/api/history/route.ts` scans `../data/history/*.json`
- No outbound network; dashboard is a filesystem reader over the Agent's `data/` directory. The dashboard must be launched from `web/` with `data/` as a sibling.

## Data Storage

**Databases:**
- None. No SQL/NoSQL database; all persistence is the local filesystem.

**File Storage (local filesystem only):**
- `data/state.json` — `AgentState` (boredom/energy/mood/temper, totals, timestamps). Read/written by `src/agent/state.ts` via `getDataPath()`. Gitignored.
- `data/agent-config.json` — behavior config (committed).
- `data/dedup/visited-urls.json` — URL cooldown tracker (`src/tools/dedup/url-tracker.ts`, base64url-hashed records, default 5-day cooldown via `config.urlCooldownDays`).
- `data/history/speaks-YYYY-MM-DD.jsonl` — append-only push history (`src/tools/push/speak.ts appendSpeakHistory()`). `.gitignore` keeps `.gitkeep` only.
- `data/history/pushed.json` — legacy push index.
- `data/wander-history.json` — rolling log of last 100 `WanderStep[]` (`src/agent/react.ts appendWanderHistory()`).
- `data/feedback.json` — Feishu reaction feedback queue (`src/memory/feedback-store.ts`). Gitignored.
- `data/logs/YYYY-MM-DD.log` — structured file logs (`src/logger/file-writer.ts`, synchronous `writeFileSync` appends).
- `data/memory/` — Long-term memory store:
  - `INDEX.md` — master index (recent/important memories, type stats, tags)
  - `data/memory/interactions/*.md` — interaction memories
  - `data/memory/knowledge/*.md` — knowledge memories
  - Managed by `MemoryStore` class in `src/memory/long-term/index.ts`; markdown frontmatter parsed by `parseMemoryFrontmatter()`; scored by recency × importance × keyword match and selected under a token budget (2.5 chars/token).

**Caching:**
- In-process module-level singletons (not a cache service):
  - DeepSeek provider cached in `src/llm/client.ts` (`deepseekProvider`) and `src/agent/react.ts` (`_provider`)
  - LarkChannel instance cached in `src/tools/push/lark-sender.ts` and `src/tools/feishu/ws-client.ts`
  - `MemoryStore` default instance in `src/memory/long-term/index.ts` (`getMemoryStore()`)
  - `MemoryStore.indexCache` for the parsed `INDEX.md`

## Authentication & Identity

**Auth Provider:**
- None for end-users. The system is a single-tenant, locally-run Agent.
- Service-to-service auth only: API keys/tokens for DeepSeek, search providers, Feishu/Lark, Telegram (see APIs section). All read from environment variables at process start in `src/config.ts`.

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry/Datadog). Errors flow through `consola` reporters only.

**Logs:**
- `consola` with custom `fileReporter` in `src/logger.ts` (level 4 / info); every log entry is同步-written to `data/logs/YYYY-MM-DD.log` via `src/logger/file-writer.ts writeLog()` (format: `[timestamp] [LEVEL] [tag] message {key=value ...}`)
- A second `consola` instance in `src/logger/file-writer.ts` is deliberately constructed with a null stdout/stderr to avoid terminal output (TUI takes over the terminal via Ink).
- TUI subscribes via `onLog()` callback (`src/logger.ts`) to render entries inside `src/tui/components/LogView.tsx`.
- `src/logger/log-cleaner.ts` runs periodic cleanup (auto-loaded by `initLogger()`).
- LLM call stats tracked in `src/llm/stats.ts` (`startLLMCall`/`endLLMCall`/`getLLMStats`); however, the current ReAct loop in `src/agent/react.ts` does not wrap `generateText` with these markers — stats are emitted but may read as zero calls per wander.

## CI/CD & Deployment

**Hosting:**
- Not defined in-repo. Agent is designed to run as a long-lived local Bun process; dashboard as a local Next.js app.

**CI Pipeline:**
- None detected (no `.github/workflows/`, no CI config files at repo root).

## Environment Configuration

**Required env vars:**
- `DEEPSEEK_API_KEY` — always required (`validateConfig()` hard-fails without it)
- `TAVILY_API_KEY` — required only when `SEARCH_PROVIDER=tavily`
- `FEISHU_WEBHOOK` **or** `TELEGRAM_BOT_TOKEN` — at least one push channel required (`validateConfig()`)

**Optional env vars:**
- `LLM_MODEL` (default `deepseek-chat`)
- `SEARCH_PROVIDER` (`duckduckgo` default, `tavily`, `exa`)
- `EXA_API_KEY` (enables Exa adapter)
- `TELEGRAM_CHAT_ID` (required together with `TELEGRAM_BOT_TOKEN` for Telegram push)
- `LARK_APP_ID`, `LARK_APP_SECRET` (enable bidirectional LarkChannel + reaction feedback; without them `initFeishuWS()` logs and skips)
- `FEISHU_WEBHOOK` (legacy one-way push fallback)

**Secrets location:**
- `.env` at repo root (gitignored via `.gitignore` line 25). `.env.example` is committed as a template (contents not read/quoted here).
- No external secrets manager (Vault, AWS Secrets Manager, etc.) is used.

## Webhooks & Callbacks

**Incoming:**
- Feishu/Lark events over the LarkChannel WebSocket long connection (`src/tools/feishu/ws-client.ts`) — handles `reaction` events only (👍/👎). No HTTP webhook endpoint is exposed by the Agent process itself.
- `data/agent-config.json` declares `feishu.receiveMode: 'webhook'` as an option, but no HTTP server implementation ships in `src/` — the active receive path is `reaction` (WebSocket).

**Outgoing:**
- Feishu Webhook `POST` (`src/tools/push/lark-sender.ts sendViaWebhook()`)
- Telegram Bot API `POST` (`src/tools/push/speak.ts pushToTelegram()`)
- Tavily/Exa/DuckDuckGo search `POST`/`GET`
- DeepSeek via `@ai-sdk/deepseek`
- Arbitrary page `GET` via `src/tools/page/reader.ts`

---

*Integration audit: 2026-06-20*
