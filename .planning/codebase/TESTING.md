# Testing Patterns

**Analysis Date:** 2026-06-20

## Test Framework

**Runner:**
- **Bun's built-in test runner** (`bun test`) — no Jest, Vitest, or Mocha.
- No `bunfig.toml` present; defaults apply (tests discovered as `*.test.ts` anywhere under the project root).
- `@types/bun` is in `devDependencies` (`package.json`), so `bun:test` types resolve globally.

**Assertion Library:**
- `bun:test` built-ins: `describe`, `test`, `expect`, `beforeEach`, `afterEach`, `mock`.
- No external assertion library (no `chai`, `sinon`, etc.).

**Run Commands:**
```bash
bun test                  # Run all tests across the repo
bun test src/tools/search # Run tests under a path
bun test duckduckgo.test  # Run a single file
```
There is **no watch mode script** and **no coverage command** in `package.json` — Bun supports `bun test --watch` and `--coverage` ad-hoc but they are not wired into npm scripts. `bun run typecheck` (`bun tsc --noEmit`) and `bun run lint` (`eslint src/`) are the companion quality gates.

## Test File Organization

**Location:**
- **Co-located** with the source file, same directory, same stem + `.test.ts`.
- Current test files (all under `src/tools/`):
  - `src/tools/search/duckduckgo.test.ts`
  - `src/tools/search/exa.test.ts`
  - `src/tools/search/tavily.test.ts`
  - `src/tools/filter/dedup.test.ts`
  - `src/tools/filter/scoring.test.ts`
  - `src/tools/content/generator.test.ts`
- **No tests under `web/`** — the Next.js dashboard has zero test coverage today.
- **No tests for** `src/agent/`, `src/memory/`, `src/llm/`, `src/tools/push/`, `src/tools/page/`, `src/tools/registry/`, `src/config.ts`, `src/index.ts`.

**Naming:**
- `<module>.test.ts` for unit tests (the only pattern present).
- No `.spec.ts`, no `__tests__/` directories, no e2e/integration folder.

**Structure:**
```
src/tools/
├── search/
│   ├── duckduckgo.ts
│   ├── duckduckgo.test.ts
│   ├── tavily.ts
│   ├── tavily.test.ts
│   ├── exa.ts
│   └── exa.test.ts
├── filter/
│   ├── dedup.ts
│   ├── dedup.test.ts
│   ├── scoring.ts
│   └── scoring.test.ts
└── content/
    ├── generator.ts
    └── generator.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { DuckDuckGoAdapter } from './duckduckgo.js';

describe('DuckDuckGoAdapter', () => {
  const adapter = new DuckDuckGoAdapter();
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('适配器可用性检查', () => {
    expect(adapter.isAvailable()).toBe(true);
  });
  // ...
});
```
(`src/tools/search/duckduckgo.test.ts:1-23`)

**Patterns:**
- `describe('<Subject>')` — subject is the class name (`DuckDuckGoAdapter`, `ExaAdapter`) or the module name (`dedup`, `scoring`, `generatePushContent`).
- `test('<Chinese behavior description>', ...)` — test names are Chinese sentences describing the behavior: `'匹配用户喜好加分'`, `'内容过短扣分'`, `'getUrlHash 对相同 URL 返回相同 hash'`, `'API 错误时抛出异常'`.
- `beforeEach` / `afterEach` save and restore globals (notably `globalThis.fetch`). Every test file that touches `fetch` uses the save/restore idiom — see all four search/content tests.
- The subject under test is instantiated once at the top of the `describe` block (`const adapter = new DuckDuckGoAdapter()`).

## Mocking

**Framework:** manual monkey-patching of `globalThis.fetch` — **no mocking library**. Pattern from `src/tools/search/duckduckgo.test.ts:16-18`:
```typescript
function mockFetch(response: Response): void {
  globalThis.fetch = (() => Promise.resolve(response)) as unknown as typeof fetch;
}
```

For richer payloads (e.g. simulating an LLM chat completion), tests inline the full JSON envelope:
```typescript
function mockFetch(responseBody: string, status = 200): void {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'test-id',
          object: 'chat.completion',
          choices: [{ message: { role: 'assistant', content: responseBody }, finish_reason: 'stop', index: 0 }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
        { status, headers: { 'Content-Type': 'application/json' } },
      ),
    )) as unknown as typeof fetch;
}
```
(`src/tools/content/generator.test.ts:45-67`)

For error cases:
```typescript
function mockFetchError(): void {
  globalThis.fetch = (() => Promise.reject(new Error('网络错误'))) as unknown as typeof fetch;
}
```
(`src/tools/content/generator.test.ts:69-71`)

**What to Mock:**
- `globalThis.fetch` — for any HTTP call (search APIs, Telegram, DeepSeek LLM). Always save in `beforeEach`, restore in `afterEach`.
- `process.env.<KEY>` — tests that exercise adapters requiring an API key set a placeholder: `process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? 'test-key'` (`src/tools/content/generator.test.ts:81`).

**What NOT to Mock:**
- Do not mock the module under test — import the real implementation (`import { DuckDuckGoAdapter } from './duckduckgo.js'`).
- Do not mock `fs` — file-based modules (`dedupResults`, long-term memory) are either tested against real temp data or left untested.
- Do not mock `consola`/`logger` — tests freely call real code paths that log; assertions target return values, not log output.

## Fixtures and Factories

**Test Data:**
- Inlined as `const` at the top of each test file (no shared `fixtures/` directory exists).
- Default-state objects are built once and spread-extended per test:
```typescript
const defaultState: AgentState = {
  boredom: 30, energy: 80, mood: 'curious', temper: 20, stubbornness: 30,
  lastAction: null, lastActionTime: null, lastHuntResult: null,
  recentTopics: [], userLikes: [], userDislikes: [], agentInterests: [],
  totalHunts: 0, totalWanders: 0, totalSteps: 0, totalPushes: 0,
  consecutiveFailures: 0, lastHeartbeat: new Date().toISOString(),
  lastHunt: null, lastWander: null, lastRest: null,
};

test('匹配用户喜好加分', () => {
  const state: AgentState = { ...defaultState, userLikes: ['科技', 'AI'] };
  // ...
});
```
(`src/tools/filter/scoring.test.ts:6-28, 42-46`)

- Result fixtures follow the same spread pattern: `const lowScoreResult: FilteredResult = { ...mockResult, score: 0.31 }` (`src/tools/content/generator.test.ts:176-179`).
- Long-content fixtures are built with `'A'.repeat(1000)` or hand-written Chinese paragraphs exceeding the threshold under test (`src/tools/content/generator.test.ts:162`, `src/tools/filter/scoring.test.ts:89`).

**Location:**
- All fixtures live in the test file that uses them. There is **no `fixtures/`, `__fixtures__/`, or `test-helpers/` directory** and **no factory functions** beyond the local `mockFetch`/`mockFetchError` helpers.
- The `generator.test.ts` file separates helpers from tests with a `// ============================================\n// Test helpers` banner (`src/tools/content/generator.test.ts:6-8`).

## Coverage

**Requirements:** None enforced. No coverage threshold, no coverage report in CI, no `--coverage` in scripts. CLAUDE.md sets a project goal of "≥ 80%" but the current state is far below that.

**Actual coverage (as of analysis date):**
- **`src/tools/search/`** — all three adapters (DuckDuckGo/Tavily/Exa) covered for happy path, max-results cap, HTTP-error propagation, and response parsing.
- **`src/tools/filter/`** — `dedup` (URL hash, URL dedup, combined dedup) and `scoring` (all score dimensions, bounds clamping, batch sorting) fully covered. Both modules are marked `@deprecated`.
- **`src/tools/content/`** — `generatePushContent` covered across moods, empty/missing content, LLM failure fallback, long content.
- **Everything else: untested** — see "Test Coverage Gaps" below.

**View Coverage:**
```bash
bun test --coverage   # ad-hoc; not wired into package.json
```

## Test Types

**Unit Tests:**
- The only test type present. Each test exercises one module in isolation with `fetch` mocked.
- Tests run without network, filesystem, or LLM access (except where they intentionally skip — see below).

**Integration Tests:**
- **Not present.** There is no test that wires together `runAgentLoop` + real tools + a stubbed LLM, nor any test that exercises the ReAct loop end-to-end.

**Conditional live tests (hybrid):**
- The search adapter tests (`exa.test.ts`, `tavily.test.ts`) contain tests that **call the real API** when `process.env.EXA_API_KEY` / `TAVILY_API_KEY` is set, and otherwise `console.log('跳过：未配置 ...')` and `return`:
```typescript
test('搜索英文话题返回结果', async () => {
  if (!process.env.EXA_API_KEY) {
    console.log('跳过：未配置 EXA_API_KEY');
    return;
  }
  // ... real fetch ...
});
```
(`src/tools/search/exa.test.ts:29-46`). This is not a proper skip — the test still passes. Prefer Bun's `test.skip` or `test.if` for this pattern in new tests.

**E2E Tests:**
- **Not used.** No Playwright/Cypress/WebDriver. The `web/` dashboard has no E2E coverage.

## Common Patterns

**Async Testing:**
```typescript
test('搜索正常话题返回结果', async () => {
  const results = await adapter.search('typescript');
  expect(results.length).toBeGreaterThanOrEqual(0);
});
```
Direct `await` inside `async` test functions; no `.then()`/`.resolves` chaining.

**Error Testing (rejection assertion):**
```typescript
test('API 错误时抛出异常', async () => {
  mockFetch(new Response(null, { status: 500, statusText: 'Internal Server Error' }));
  await expect(adapter.search('test')).rejects.toThrow();
});
```
(`src/tools/search/duckduckgo.test.ts:65-68`, identical pattern in `tavily.test.ts:75-78` and `exa.test.ts:75-78`)

**Error Testing (fallback-not-throw):**
```typescript
test('LLM 调用失败：返回默认文案，不抛出异常', async () => {
  mockFetchError();
  const result = await generatePushContent(mockResult, defaultState);
  expect(result.message).toBe('嘿，找到个有意思的东西，看看？');
});
```
(`src/tools/content/generator.test.ts:131-139`)

**Bounds / invariant assertions:**
```typescript
test('评分范围限制在 0-1', () => {
  const scored = calculateScore(result, state);
  expect(scored.score).toBeGreaterThanOrEqual(0);
  expect(scored.score).toBeLessThanOrEqual(1);
});
```
(`src/tools/filter/scoring.test.ts:125-141`)

**Diagnostic logging in tests:** tests liberally `console.log` query strings and result counts for human inspection when running `bun test` manually (e.g. `console.log(`[query] ${query}`)` in `duckduckgo.test.ts:30-36`). This is accepted project style for the search adapter tests.

**Test for non-mutation / idempotency:**
```typescript
test('dedupByUrl 对无重复结果不变', () => {
  const deduped = dedupByUrl(results);
  expect(deduped.length).toBe(3);
});
```
(`src/tools/filter/dedup.test.ts:45-55`)

## Test Coverage Gaps

Priority gaps for future test work (CLAUDE.md target ≥ 80%):

**Agent core loop (HIGH):**
- Untested: `src/agent/react.ts` (`runAgentLoop`), `src/agent/state.ts` (`loadState`/`saveState`/`heartbeat`/`recordFeedback`), `src/agent/planner.ts`, `src/agent/actions.ts`.
- Risk: the ReAct loop is the system's central behavior; state-persistence bugs and mood-transition bugs would go unnoticed.

**LLM client (HIGH):**
- Untested: `src/llm/client.ts` (`callLLM`, `callLLMForDecision` — JSON extraction + Zod schema validation against LLM output).
- Risk: `callLLMForDecision` parses free-form LLM JSON; malformed responses are a real failure mode.

**Tool registry + ToolManager (MEDIUM):**
- Untested: `src/tools/tool-manager.ts` (static registry, enable/disable, `reset()` exists specifically for tests but is never used), `src/tools/registry/auto-register.ts`, individual tool definitions (`search-web.ts`, `speak.ts`, `rest.ts`, `read-page.ts`, `record-knowledge.ts`, `observe-user.ts`, `read-feedback.ts`).

**Memory system (MEDIUM):**
- Untested: `src/memory/long-term/index.ts` (`MemoryStore` CRUD, `buildMemoryContext` token budgeting, index parsing), `src/memory/user-profile.ts`, `src/memory/feedback-store.ts`.
- Risk: markdown frontmatter parsing/writing and path-traversal sanitization (`toSafeFilename`) are security-sensitive and currently only exercised in production.

**Push / page / dedup modules (MEDIUM):**
- Untested: `src/tools/push/speak.ts` (multi-channel fan-out), `src/tools/page/reader.ts` (Readability extraction + link extraction), `src/tools/dedup/url-tracker.ts` (cooldown logic), `src/tools/filter/history.ts`.
- Note: the *old* `filter/dedup.ts` and `filter/scoring.ts` ARE tested, but both are `@deprecated`.

**Web dashboard (LOW for agent, HIGH for dashboard quality):**
- Entirely untested. No component tests, no hook tests (`useAgentState`, `useHistory`), no API route tests. Next.js 16 + React 19 has zero coverage here.

**Config (LOW):**
- Untested: `src/config.ts` (`loadBehaviorConfig` merge, `getRecoveryTier`, `validateConfig`).

---

*Testing analysis: 2026-06-20*
