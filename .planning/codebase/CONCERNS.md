# Codebase Concerns

**Analysis Date:** 2026-06-20

## Tech Debt

**Dead ReAct-predecessor code paths (largest tech debt):**
- Issue: A complete legacy decision pipeline (`Planner → Decision → Actions`) was superseded by the ReAct Loop in `src/agent/react.ts` but never removed. The legacy modules only reference each other; nothing in the live entry path (`src/index.ts` → `runAgentLoop`) imports them.
- Files:
  - `src/agent/planner.ts` (entire file, 113 lines) — `decide()` never called from live code
  - `src/agent/actions.ts` (entire file, 166 lines) — `executeAction`/`executeHunt`/`executeComplain`/`executeCelebrate`/`executeIgnore`/`executeProcrastinate` never invoked. Four of the six action functions are stubs with `// TODO: Phase 4 实现` comments (`src/agent/actions.ts:74`, `:91`, `:108`, `:121`).
  - `src/prompts/decision.ts` (file marked `@deprecated` at line 2)
  - `src/constants/decision.ts` (file marked `@deprecated` at line 2) — still re-exported by `src/types.ts:67-69`, so removing it requires touching the type layer.
  - `src/tools/filter/index.ts`, `src/tools/filter/dedup.ts`, `src/tools/filter/scoring.ts` (all three marked `@deprecated` "使用 LLM Tool Calling 替代" at top of file) — `filterResults()` is only called from dead `src/agent/actions.ts:27`.
  - `src/tools/content/generator.ts` + `src/prompts/content.ts` — `generatePushContent()` is only called from dead `src/agent/actions.ts:44`; its test `src/tools/content/generator.test.ts` is effectively dead-test coverage.
  - `src/llm/client.ts:71` `callLLMForDecision()` — only called from dead `src/agent/planner.ts:102`.
- Impact: ~600+ lines of confusing dead code that suggests two parallel decision architectures exist. New contributors may modify legacy modules assuming they are live. The `@deprecated` markers are inconsistent (only on some files) and easy to miss.
- Fix approach: Delete the six files listed above plus the dead tests in `src/tools/content/generator.test.ts`, `src/tools/filter/*.test.ts` (the scoring/dedup tests cover only the deprecated filter pipeline). Then remove the `import type { ActionType }` re-export in `src/types.ts:67-69` and inline the literal union into `AgentState.lastAction`. Confirm `bun run typecheck` passes after deletion.

**Deprecated fields still in `AgentState`:**
- Issue: `src/types.ts` carries four `@deprecated` fields (`lastHuntResult:30`, `totalHunts:40`, `lastHunt:49`, and the entire `HuntResult` type:13) kept "for compatibility" but only written by the dead `executeHunt` in `src/agent/actions.ts:57-58`. The live ReAct path uses `lastWander`/`totalWanders`.
- Files: `src/types.ts:13,29-30,39-40,48-49`; `src/agent/state.ts:10-45` (default state still populates them).
- Impact: `data/state.json` accumulates stale `lastHunt`/`totalHunts` keys that nothing reads, polluting state diffing and the web dashboard payload.
- Fix approach: Drop the four fields from `AgentState`, remove their defaults in `createDefaultState()`, and add a one-time migration in `loadState()` (`src/agent/state.ts:72`) that strips unknown keys (or simply rely on the `{...defaultState, ...parsed}` spread to keep them harmlessly until next reset).

**Type-safety escape hatches via `as unknown`:**
- Issue: Four sites cast through `unknown` to satisfy the stream typing for `consola`, and one site re-casts a tool result. These suppress real type errors instead of fixing the types.
- Files:
  - `src/logger.ts:52-53`, `src/logger/log-cleaner.ts:15-16`, `src/logger/file-writer.ts:16-17` — `stdout: nullStream as unknown as NodeJS.WriteStream` (3 copies of the same workaround).
  - `src/prompts/react.ts:74` — `const page = r as unknown as PageResult` inside `formatLastToolResult`, bypassing validation of LLM-returned tool output.
- Impact: A `Writable` is not actually a `NodeJS.WriteStream` (no `.columns`, `.isTTY`, etc.); any future consola code reading those properties will throw at runtime with no compile-time warning.
- Fix approach: Extract the null-stream construction into one helper (e.g. `src/logger/null-stream.ts`) returning the correct type, or pass `false`/`undefined` to consola's `stdout` option if supported. For the prompt case, narrow with a runtime check (`if (typeof r.content === 'string' && Array.isArray(r.links))`) before treating as `PageResult`.

**`createTools()` backward-compat shim:**
- Issue: `src/tools/registry/index.ts:22` re-exports `createTools(ctx)` marked `@deprecated`, but no caller uses it — `src/agent/react.ts:169` calls `ToolManager.getTools(ctx)` directly.
- Files: `src/tools/registry/index.ts:17-24`; `src/tools/registry/_template.ts:7` still tells authors to "在 registry/index.ts 中的 createTools() 里注册" (stale instruction — registration now happens in `src/tools/registry/auto-register.ts`).
- Impact: The template misleads anyone adding a new tool; they'll edit the wrong file.
- Fix approach: Remove `createTools`, update `_template.ts:7` step 3 to point at `src/tools/registry/auto-register.ts` `TOOL_DEFINITIONS`.

## Known Bugs

**LLM call statistics are always zero:**
- Symptoms: `STAT === 游荡结束 ===` log in `src/agent/react.ts:192` always reports `llmCalls: 0, llmTotalMs: 0, llmAvgMs: 0`.
- Files: `src/llm/stats.ts` (defines `startLLMCall`/`endLLMCall`); `src/agent/react.ts:130,189` (calls `resetLLMStats()` and `getLLMStats()` but never brackets the `generateText` call with start/end).
- Trigger: Every wander; `src/llm/stats.ts:31` `endLLMCall` is never invoked anywhere in the repo (confirmed: `startLLMCall`/`endLLMCall` have zero live callers).
- Workaround: None — the metrics are silently wrong.
- Fix approach: Wrap the `await generateText({...})` call at `src/agent/react.ts:172` in `startLLMCall()` / `finally { endLLMCall(); }`, or move the timing into the DeepSeek provider wrapper.

**Web dashboard `/api/history` returns empty:**
- Symptoms: `web/app/api/history/route.ts:12` filters `files.filter((f) => f.endsWith(".json"))`, but the agent writes `data/history/speaks-YYYY-MM-DD.jsonl` (`src/tools/push/speak.ts:41`). No matching files; endpoint always returns `data: []`.
- Files: `web/app/api/history/route.ts:12,17`; `src/tools/push/speak.ts:41`.
- Trigger: Any request to `/api/history` after the agent has pushed.
- Workaround: None.
- Fix approach: Change the filter to `.json` OR `.jsonl`, and parse the JSONL file line-by-line (each line is one `SpeakRecord`) instead of `JSON.parse(content)` as a single object.

**`read_page` swallows all errors as soft results:**
- Symptoms: Fetch failures, HTTP non-2xx, and Readability parse failures all return `{ error: ... }` with `content: ''` instead of throwing (`src/tools/page/reader.ts:103-124,155-165`). The LLM in the ReAct loop sees a successful tool result with empty content and may loop trying other URLs.
- Files: `src/tools/page/reader.ts:88-166`.
- Trigger: Network error, 4xx/5xx, or non-HTML content during `read_page`.
- Workaround: None.
- Fix approach: This is intentional ("不中断 ReAct Loop" per the file header) but conflicts with `CLAUDE.md` rule "错误就是错误，失败就该报错". At minimum, increment `ctx.consecutiveFailures` (currently not tracked) when `error` is set, so the loop can break early on repeated failures.

**DuckDuckGo adapter only returns abstract + related topics:**
- Symptoms: `src/tools/search/duckduckgo.ts:55-81` parses only `AbstractText`/`AbstractURL`/`RelatedTopics` from the DuckDuckGo Instant Answer API. The DDG IA API returns nothing for most queries (it is an answer engine, not a search engine), so `search_web` with `quality=free` frequently returns `[]`.
- Files: `src/tools/search/duckduckgo.ts`; `src/tools/search/index.ts:27-32` silently falls back to the same empty adapter.
- Trigger: Any non-encyclopedic query (e.g. news, recent events).
- Workaround: Use `quality=premium` (requires `EXA_API_KEY` or `TAVILY_API_KEY`).
- Fix approach: Either scrape `html.duckduckgo.com/html/` (with rate-limiting) or document that the free adapter is answer-only and default `search_web` to `premium` when a key is configured.

**Empty-catch fallback in `extractRecentTopics`:**
- Symptoms: `src/agent/react.ts:87` swallows URL parse errors silently with `// 忽略无效 URL`; the same pattern repeats at `:203` and `src/memory/long-term/write.ts:135`. Combined with the `catch {}` blocks at `src/memory/long-term/index.ts:206`, these hide malformed data.
- Files: `src/agent/react.ts:87,203`; `src/memory/long-term/index.ts:206`; `src/memory/long-term/write.ts:135`.
- Fix approach: Replace silent catches with `logger.warn` carrying the offending value, per `CLAUDE.md` logging rules.

## Security Considerations

**Web dashboard API has no authentication or authorization:**
- Risk: `web/app/api/state/route.ts` and `web/app/api/history/route.ts` expose agent state and push history to any caller. No middleware, no auth header check, no CORS restriction (confirmed: no `web/middleware.ts` exists).
- Files: `web/app/api/state/route.ts`; `web/app/api/history/route.ts`.
- Current mitigation: None. The routes bind to relative `../data/` so they only work in dev, but if deployed they leak state.
- Recommendations: Add `web/middleware.ts` with a shared-secret header check (`X-Dashboard-Token`) before deploying; or gate the routes behind NextAuth. Restrict CORS to known origins.

**Hardcoded relative paths assume CWD == repo root:**
- Risk: Twelve sites hardcode `data/...` paths relative to `process.cwd()`. If the agent or web server is launched from a different working directory, reads/writes hit the wrong location (or silently create new state files), and in the web case `../data/state.json` could resolve outside the repo.
- Files: `src/config.ts:4,147`; `src/logger/file-writer.ts:20`; `src/logger/log-cleaner.ts:19`; `src/tools/push/speak.ts:40-41`; `src/agent/react.ts:66`; `src/memory/user-profile.ts:8,63`; `src/memory/long-term/types.ts:54`; `src/memory/feedback-store.ts:14`; `web/app/api/state/route.ts:11`; `web/app/api/history/route.ts:11,17`.
- Current mitigation: `getDataPath()` in `src/config.ts:146` centralizes the pattern but is not used everywhere (only `state.ts` and `url-tracker.ts` use it).
- Recommendations: Route all data paths through `getDataPath()` (or a new `resolveDataPath()` that anchors to `import.meta.url`), and resolve web API paths from an env var (`DATA_DIR`) instead of `../`.

**Secrets are read from env but never leaked (verified):**
- Risk: Low. `grep` for `secret|token|password|apiKey` near `logger|console` returned no matches. `DEEPSEEK_API_KEY` is logged only as presence-checks in error messages.
- Files: `src/config.ts:80-94`; `src/agent/react.ts:31`; `src/tools/feishu/ws-client.ts:32-33`; `src/tools/push/lark-sender.ts:23-30`.
- Current mitigation: `.env` is gitignored (`.gitignore:35`).
- Recommendations: Keep as-is; add a pre-commit hook that blocks commits containing `sk-`, `Bearer `, or API-key-shaped strings.

**Webhook endpoints accept arbitrary content and forward it to Feishu/Telegram:**
- Risk: The agent pushes whatever the LLM generates via `speak()` to external channels with no content filtering. Malicious prompt injection in a scraped page could cause the agent to push spam or links to subscribers.
- Files: `src/tools/push/speak.ts:95-184`; `src/tools/page/reader.ts:88` (untrusted HTML → LLM context).
- Current mitigation: `MAX_CONTENT_LENGTH = 5000` truncation in `reader.ts:8`; no content scanning.
- Recommendations: Add a URL allowlist/denylist for `extractUrl` (`src/tools/dedup/url-tracker.ts:207`), and rate-limit `speak()` per wander (currently only bounded by `maxWanderSteps`).

## Performance Bottlenecks

**`MemoryStore.getRecentMemories` reads every file on each call:**
- Problem: For each memory type, the method calls `readdir` then `getMemory` per file, and `getMemory` (`src/memory/long-term/index.ts:256`) rewrites the file to bump `accessedAt` on every read. With N memories this is O(N) file reads + O(N) file writes per invocation.
- Files: `src/memory/long-term/index.ts:281-309` (loop), `:256-276` (read-then-write).
- Cause: No caching layer; `indexCache` is populated by `updateIndex` but never read by `readIndex` (`:62` always hits disk).
- Improvement path: (1) Make `readIndex` return `this.indexCache` when fresh; (2) stop writing `accessedAt` on every read (batch-update once per wander); (3) build a JSON sidecar index of `{id → {timestamp, importance, tags}}` to avoid parsing every Markdown file.

**`searchMemories` loads 100 entries then filters in memory:**
- Problem: `src/memory/long-term/index.ts:314` calls `getRecentMemories({ count: 100 })` (which itself iterates all files) and then does a linear `.filter` — no indexing on tags/content.
- Files: `src/memory/long-term/index.ts:314-324`.
- Improvement path: Invert into a tag→ids map persisted in `INDEX.md` (the infrastructure is already half-built — `index.tags` exists but is unused for lookup).

**`buildMemoryContext` calls `getRecentMemories` once per type in a loop:**
- Problem: `src/memory/long-term/index.ts:369-372` invokes `getRecentMemories({ count: 30, type })` inside a `for` over 3–4 types, tripling the readdir/rewrite cost above.
- Files: `src/memory/long-term/index.ts:361-382`.
- Improvement path: Single pass over all directories, group by type in memory.

**`url-tracker` rewrites the entire JSON store on every visit:**
- Problem: `addVisitedUrl` (`src/tools/dedup/url-tracker.ts:148`) loads the full store, mutates, and writes the whole file back. With the file growing linearly, every `speak` triggers an O(N) write.
- Files: `src/tools/dedup/url-tracker.ts:77-113,148-173`.
- Cause: JSON-file-as-database with no append-only or batching.
- Improvement path: Switch to SQLite (Bun has built-in `bun:sqlite`), or append JSONL records and compact periodically.

## Fragile Areas

**Markdown regex parsing of `INDEX.md`:**
- Files: `src/memory/long-term/index.ts:105-169` (`parseIndexFromMarkdown`), `:203-209` (`parseTypeStats`).
- Why fragile: Section detection relies on exact Chinese headings (`## 最近记忆`, `## 重要记忆`, `## 标签`). Any LLM- or human-edit that tweaks the heading text silently drops the section's data. `parseTypeStats` JSON.parse is wrapped in `catch { return zeros }` — a corrupted `typeStats` line resets all counters to 0 with no warning.
- Safe modification: If editing `INDEX.md` by hand, keep headings byte-identical. If changing section names, update both `formatIndexToMarkdown` and `parseIndexFromMarkdown` in the same commit.
- Test coverage: No tests for `parseIndexFromMarkdown` / `formatIndexToMarkdown` round-trip.

**`MEMORY_TYPE_PATHS` and tag parsing spread across 3 files:**
- Files: `src/memory/long-term/types.ts` (definitions), `src/memory/long-term/index.ts` (parsing), `src/memory/long-term/consolidate.ts` (separate parsing of `accessedAt` at `:28-33` that duplicates frontmatter logic).
- Why fragile: `consolidate.ts:28` re-implements frontmatter extraction with its own regex instead of reusing `parseMemoryFrontmatter`; if the frontmatter format changes, the two parsers will drift.
- Safe modification: Any change to `formatMemoryToMarkdown` must be mirrored in `extractAccessedAt`.
- Test coverage: None.

**ReAct loop error path leaves `endReason` inconsistent:**
- Files: `src/agent/react.ts:148` (`endReason: 'max_steps'` default), `:185` (sets `'error'` on catch). But the stop conditions `hasToolCall('rest')` and `stepCountIs(maxSteps)` don't update `endReason` to `'rest'` — the ctx is mutated by tools, and `rest` only short-circuits the SDK loop without setting the field. So a successful rest-ended wander logs `endReason: 'max_steps'` even when it ended early.
- Why fragile: Downstream logic (e.g. `consecutiveFailures` reset at `:243`) keys off `endReason === 'error'`; the rest/max_steps conflation is currently harmless but will mislead any future branching.
- Safe modification: When adding new end conditions, explicitly mutate `ctx.endReason` inside the tool's `execute` (see `src/tools/registry/rest.ts`).
- Test coverage: No test for `runAgentLoop`.

**`updateState` is read-modify-write without locking:**
- Files: `src/agent/state.ts:97-104`.
- Why fragile: The comment at `src/agent/actions.ts:53` claims "单线程心跳循环下安全", but the Feishu WebSocket handler at `src/tools/feishu/ws-client.ts:82` calls `updateMoodByFeedback` → `updateState` from a different async call stack while a wander may be mid-`updateState`. Last write wins; a feedback event during state-save can clobber wander results.
- Safe modification: Do not introduce parallel state writers without serializing through a queue.
- Test coverage: None for concurrent writes.

## Scaling Limits

**File-based persistence:**
- Current capacity: `data/` is 904KB total; `data/state.json` ~11KB; `data/wander-history.json` ~29KB capped at 100 entries (`src/agent/react.ts:67`); `data/dedup/visited-urls.json` ~1.8KB with no entry cap.
- Limit: JSON-file-as-DB breaks down around thousands of records due to full-file rewrites (see Performance Bottlenecks). `visited-urls.json` has no size cap — `cleanupVisitedUrls` exists (`src/tools/dedup/url-tracker.ts:179`) but is never called from any live code path (only exported).
- Scaling path: Migrate hot paths (visited URLs, wander history, feedback store) to SQLite.

**Long-term memory growth:**
- Current capacity: `MemoryConsolidator` exists (`src/memory/long-term/consolidate.ts`) with `consolidateOldMemories`, `mergeTopicMemories`, `cleanupExpired` — but none of these are wired into any live entry point (grep shows zero callers outside the file itself).
- Limit: Memory directory grows unbounded; `cleanupExpired` is dead code.
- Scaling path: Invoke `cleanupExpired()` on startup (alongside `initLogCleaner()` in `src/logger.ts:57`) and run `consolidateOldMemories` weekly.

## Dependencies at Risk

**`@larksuiteoapi/node-sdk` LarkChannel singleton duplication:**
- Risk: `createLarkChannel` is called in two separate singletons — `src/tools/feishu/ws-client.ts:43` (for receiving events) and `src/tools/push/lark-sender.ts:30` (for sending messages). They are not coordinated; two WebSocket connections to Feishu from the same app may trigger rate limits or event duplication.
- Impact: Duplicate events → double-charged feedback updates (`recordFeedback` dedups by `messageId+type` at `src/memory/feedback-store.ts:95`, so the impact is bounded, but the connection overhead is real).
- Migration plan: Unify into one `getLarkChannel()` provider that both modules share.

**`pptxgenjs` + `@mozilla/readability` + `jsdom` are heavyweight for runtime:**
- Risk: `pptxgenjs` (PPT generation) is a large dependency loaded only for the one-off `generate-ppt.cjs` script (which is untracked, not part of the runtime). `jsdom` is used at runtime in `src/tools/page/reader.ts` for every `read_page` call — slow and memory-heavy.
- Impact: Cold start and per-page memory cost; `read_page` is the most-called tool in the ReAct loop.
- Migration plan: Move `pptxgenjs` to `devDependencies` (or a separate workspace). For `read_page`, evaluate `@mozilla/readability` without JSDOM (e.g. `linkedom`, ~10x smaller).

## Missing Critical Features

**No retry / backoff on LLM or external API calls:**
- Problem: `generateText` in `src/agent/react.ts:172` and `fetch` in all search adapters (`duckduckgo.ts:27`, `exa.ts:31`, `tavily.ts`) have a single `AbortSignal.timeout` with no retry on 429/5xx. A transient DeepSeek rate-limit kills the whole wander (`endReason: 'error'`).
- Blocks: Reliable long-running operation; every transient API hiccup wastes a full wander budget.
- Fix approach: Wrap external calls in a `withRetry(fn, { retries: 3, backoff: 'exponential' })` helper.

**No metrics / observability export:**
- Problem: LLM stats are broken (see Known Bugs). Beyond that, there is no structured logging sink (JSON logs to `data/logs/` via `src/logger/file-writer.ts`, but no Prometheus/OTel export). Search latencies, push success rates, and wander durations are only in human-readable logs.
- Blocks: Production monitoring.
- Fix approach: Emit structured JSON logs (consola supports JSON reporter); fix the stats module first.

**`cleanupVisitedUrls` and all `MemoryConsolidator` methods are unwired:**
- Problem: Five cleanup/compaction functions exist but have zero live callers — visited URLs grow forever, memory files grow forever, logs are cleaned but memories aren't.
- Files: `src/tools/dedup/url-tracker.ts:179` (`cleanupVisitedUrls`); `src/memory/long-term/consolidate.ts:103,165,217`.
- Blocks: Long-running deployment without manual intervention.
- Fix approach: Schedule both alongside `initLogCleaner()` (`src/logger.ts:57`).

## Test Coverage Gaps

**Critical untested paths:**
- What's not tested: `src/agent/react.ts` (`runAgentLoop` — the core loop), `src/agent/state.ts` (state machine + persistence), `src/tools/push/speak.ts`, `src/tools/push/lark-sender.ts`, `src/tools/feishu/ws-client.ts`, `src/memory/feedback-store.ts`, `src/memory/user-profile.ts`, `src/memory/long-term/index.ts` (MemoryStore), `src/tools/dedup/url-tracker.ts`, `src/config.ts` (config loading + validation).
- Files: 30 of ~38 non-test source files have no co-located test (only 6 test files exist: 3 search adapters, 2 filter, 1 content generator — and the filter/content tests cover deprecated code).
- Risk: The most critical file (`react.ts`) has zero coverage; any change to the ReAct loop ships unverified. State persistence bugs (e.g. the concurrent-write issue above) would not be caught.
- Priority: High — add tests for `runAgentLoop` (mock `generateText`), `loadState`/`saveState`/`updateState` round-trip, `MemoryStore.saveMemory`/`getMemory` round-trip, and `url-tracker` cooldown logic.

**Live test files cover deprecated modules:**
- What's not tested (effectively): `src/tools/filter/scoring.test.ts` and `src/tools/filter/dedup.test.ts` test code marked `@deprecated` that is never executed in production. `src/tools/content/generator.test.ts` tests a function only callable from dead `actions.ts`.
- Files: `src/tools/filter/scoring.test.ts`, `src/tools/filter/dedup.test.ts`, `src/tools/content/generator.test.ts`.
- Risk: False sense of coverage — the test suite passes but validates dead code.
- Priority: Medium — delete with the deprecated modules, replace with tests for the live ReAct tools.

**No integration / E2E tests:**
- What's not tested: End-to-end wander (config → heartbeat → ReAct loop → push), Feishu WebSocket event handling, web dashboard API routes.
- Files: No `*.integration.test.ts` or E2E setup.
- Risk: The integration surface (state ↔ ReAct ↔ push ↔ dedup) is where the bugs above (stats=0, history endpoint empty, endReason inconsistency) actually live.
- Priority: Medium — one smoke test that runs a mocked wander end-to-end would catch all three known bugs.

---

*Concerns audit: 2026-06-20*
