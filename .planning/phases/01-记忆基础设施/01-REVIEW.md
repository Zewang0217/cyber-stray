---
phase: 01-记忆基础设施
reviewed: 2026-06-20T00:00:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - data/agent-config.json
  - src/agent/react.test.ts
  - src/agent/react.ts
  - src/config.ts
  - src/index.ts
  - src/llm/stats.test.ts
  - src/llm/stats.ts
  - src/memory/long-term/archive.ts
  - src/memory/long-term/consolidate.test.ts
  - src/memory/long-term/consolidate.ts
  - src/memory/long-term/index.test.ts
  - src/memory/long-term/index.ts
  - src/memory/long-term/memory-index.test.ts
  - src/memory/long-term/memory-index.ts
  - src/memory/long-term/types.ts
  - src/types.ts
findings:
  critical: 6
  warning: 11
  info: 5
  total: 22
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-06-20T00:00:00Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

This phase introduces a JSON sidecar memory index, refactors `MemoryStore` to double-write Markdown + JSON, adds soft-delete archival, externalizes consolidation thresholds, and rewires the ReAct loop (drop forced `speak`, per-step counting via `onStepFinish`, `generateText` retry). The scaffolding is reasonable and tests exist, but **adversarial tracing surfaced several serious correctness defects** that will cause silent data loss, broken检索, and statistics under-counting in production.

Top concerns (all Critical):
1. **`.index.json` rebuild is never invoked at startup** despite the code comment claiming "启动时若缺失则 rebuild". The whole "Markdown 是真相源，崩溃自愈" design is broken — empty/missing index → silent empty检索 results.
2. **Consolidator archives Markdown but leaves orphan records in `.index.json`** (and INDEX.md). `getRecentMemories` will then try to read archived (deleted) files and silently drop them — a hidden staleness bug.
3. **`react.ts` double-counts steps**: `onStepFinish` increments stats `calls`, but `ctx.stepCount` is also bumped by every tool (`search-web.ts`, `rest.ts`, etc.). A text-only LLM step (no tool call) does not increment `ctx.stepCount`, so `state.totalSteps` is under-counted and `energy/boredom` deltas drift.
4. **`config.ts` calls `loadBehaviorConfig()` four times** at module load (spreading side-effects) and **reconstructs `feishu` from 3 separate reads** — fragile, slow, and a likely source of config drift.
5. **`appendWanderHistory` is non-atomic** (plain `writeFile`, no `rename`) and uses a hard-coded relative path `data/wander-history.json` (ignores `DATA_DIR` / `getDataPath`), conflicting with the test infra redirection pattern.
6. **`react.ts` retry loop does not break on success correctly for the final attempt** — but worse, when all retries fail it still runs the full downstream summary/state-update logic as if the loop succeeded, writing `totalWanders+1` for a failed run.

A number of additional Warnings cover inconsistent default duplication (consolidation thresholds live in 3 places), `archive.ts` filename mangling (always appending `.md` after sanitization breaks file identity), and magic numbers. All findings carry file/line citations and concrete fixes.

---

## Critical Issues

### CR-01: `.index.json` 崩溃自愈承诺未实现 — rebuild 从未在启动时调用

**File:** `src/memory/long-term/memory-index.ts:11-15`, `src/index.ts:50-91`
**Issue:**
`memory-index.ts` docstring explicitly claims:
> "崩溃自愈：启动时若 `.index.json` 缺失或 schema 不匹配，调 `rebuildIndexFromMarkdown()` 从 Markdown 重建"

`MemoryStore`'s `updateIndexAfterSave` (index.ts:581) also claims "崩溃后由启动 rebuildIndexFromMarkdown 自愈".

But `grep -rn "\.rebuild(\|rebuildIndexFromMarkdown" src/` shows **no production caller** — `rebuild()` is only defined, never invoked. `src/index.ts:runStartupMemoryMaintenance` calls `cleanupVisitedUrls` + `consolidator.consolidateOldMemories()` + `consolidator.cleanupExpired()` but **never triggers index rebuild**.

Consequence: on first run, `.index.json` does not exist; `getMemoryIndex().ensureLoaded()` returns the empty default; `getRecentMemories` returns `[]`; `buildMemoryContext` returns `''`; the agent runs with empty memory context forever until a new `saveMemory` happens to populate the index. After a crash corrupting `.index.json`, `loadJsonIndex` throws and the failure cascades upward — there is no recovery.

This is a **BLOCKER**: the phase's core deliverable (JSON sidecar索引) does not function without manual rebuild. Tests pass only because each test constructs `MemoryStore({ basePath })` with `_resetMemoryIndex()` then immediately `saveMemory` to populate.

**Fix:**
```typescript
// src/index.ts — inside runStartupMemoryMaintenance, after cleanup
try {
  const store = getMemoryStore();
  // 启动期 ensureLoaded 会读 .index.json；若缺失/损坏触发 rebuild
  await store.ensureIndexConsistent(); // 新增方法
} catch (error) {
  logger.warn('启动期索引校验/重建失败（不阻断启动）', { error: String(error) });
}
```
```typescript
// src/memory/long-term/index.ts — add to MemoryStore
async ensureIndexConsistent(): Promise<void> {
  try {
    // 尝试加载；若抛错（schema 漂移 / 非法 JSON）→ rebuild
    await this.jsonIndex.getRecords();
  } catch (error) {
    logger.warn('JSON 索引异常，从 Markdown 重建', { error });
    await this.jsonIndex.rebuild();
  }
  // 文件缺失检测：若 Markdown 有但 records 为空，也 rebuild
  const records = await this.jsonIndex.getRecords();
  if (records.length === 0) {
    const counts = await this.countMarkdownFiles();
    if (counts > 0) {
      logger.info('检测到 Markdown 但索引为空，触发 rebuild', { markdownFiles: counts });
      await this.jsonIndex.rebuild();
    }
  }
}
```

---

### CR-02: Consolidator 归档 Markdown 不联动 JSON 索引 / INDEX.md，留下孤儿记录

**File:** `src/memory/long-term/consolidate.ts:156, 239, 287`; `src/memory/long-term/archive.ts:35-57`
**Issue:**
All three cleanup paths (`consolidateOldMemories`, `mergeTopicMemories`, `cleanupExpired`) call `archiveFile(filepath, t, basePath)` to `rename` Markdown into `.archive/<type>/`, but **none** of them call `this.store.jsonIndex.remove()` or update INDEX.md.

Compare to `MemoryStore.deleteMemory` (index.ts:389-403) which does the correct three-way cleanup: `rm` + INDEX.md update + `jsonIndex.remove()` + `jsonIndex.persist()`.

Consequences (silent corruption):
1. After `consolidateOldMemories` archives 10 files, `.index.json` still has those 10 records pointing at now-archived paths.
2. Next `getRecentMemories` call: `jsonIndex.queryRecent` returns those IDs, then `readFile(rec.filepath)` fails (file moved to `.archive/...`), and the `catch` at index.ts:337 silently swallows — **`getRecentMemories` returns fewer records than asked, with no warning to the caller**.
3. `state.totalMemories` in INDEX.md keeps growing without bound (only `saveMemory`/`deleteMemory` ever decrement it; archival does not).
4. The "D-04 双记 observation" records each archive event as a new memory — which itself goes through `saveMemory` and re-adds to the index — masking the stale-record problem during tests because tests only assert on presence of the new record.

**Fix:** `archiveFile` should accept the store and perform the triple-write cleanup, mirroring `deleteMemory`:
```typescript
// src/memory/long-term/consolidate.ts — replace each archiveFile(...) with:
await this.archiveAndUnindex(filepath, t);
// (private helper)
private async archiveAndUnindex(filepath: string, type: MemoryType): Promise<void> {
  await archiveFile(filepath, type, this.basePath);
  if (!this.store) return;
  const id = basename(filepath).replace(/\.md$/, '');
  // 同步从 .index.json 剔除（deleteMemory 已有同样模式，可复用）
  await this.store.unlinkMemoryFromIndex(type, id);
}
```
And expose a public `unlinkMemoryFromIndex` on `MemoryStore` (or have `archiveFile` take the store directly). Add regression test asserting that after `cleanupExpired`, `loadJsonIndex(...).records` does not contain archived IDs.

---

### CR-03: `react.ts` 步数计数错位 — `ctx.stepCount` 与 LLM 真实步数不一致

**File:** `src/agent/react.ts:134-282`; `src/tools/registry/search-web.ts:46`, `rest.ts:22`, `read-page.ts:27`, `speak.ts:37`, `record-knowledge.ts:39`, `observe-user.ts:58`, `read-feedback.ts:38,91`, `_template.ts:26`
**Issue:**
There are **two parallel counters** in the ReAct loop:
- `ctx.stepCount` — incremented inside each tool's `execute` (e.g. `search-web.ts:46` `ctx.stepCount++`).
- `llmStats.calls` — incremented inside `onStepFinish` callback (stats.ts), one per LLM step.

The AI SDK v6 `onStepFinish` fires for **every step**, including pure-text steps that produce no tool call. The tool-incremented `ctx.stepCount` only counts steps that called a tool. The final state update (react.ts:267-270) uses **`ctx.stepCount`** for `totalSteps`, `boredom`, and `energy` deltas:

```typescript
totalSteps: state.totalSteps + ctx.stepCount,
boredom: Math.max(0, state.boredom - ctx.stepCount * BOREDOM_REDUCTION_PER_STEP),
energy: Math.max(0, state.energy - ctx.stepCount * ENERGY_COST_PER_STEP),
```

So if the LLM takes 3 text-only reasoning steps + 2 tool steps, `ctx.stepCount = 2` but the actual LLM cost corresponds to 5 calls. State deltas (`energy`, `boredom`) will be systematically under-applied; `state.totalSteps` under-reported; `llmStats.calls` (in the same STAT log) will mismatch `ctx.stepCount` shown as `steps: ${ctx.stepCount}/${maxSteps}`.

Additionally, `stopWhen: stepCountIs(maxSteps)` (react.ts:196) uses the **AI SDK's** internal step count, not `ctx.stepCount`. So the loop can terminate at `maxSteps=10` AI-SDK steps while `ctx.stepCount` is, say, 6 — making `result.steps` reported to the caller lie about whether `max_steps` was actually hit.

**Fix:** Unify on one source of truth. Two viable options:
- **(Recommended)** Drop per-tool `ctx.stepCount++` and read step count from `llmStats.calls` at the end:
  ```typescript
  const stepsTaken = getLLMStats().calls;
  // ...use stepsTaken for state deltas and return value
  ```
- Or have tools only record semantic events (e.g. `searchCount++`) and introduce a dedicated `llmStepCount` field sourced from `onStepFinish`. Either way, the return value `result.steps` and `ctx.stepCount` used for state deltas must match the same definition used by `stepCountIs(maxSteps)`.

---

### CR-04: `config.ts` 4 次 `loadBehaviorConfig()` 调用 + `feishu` 重建丢嵌套字段

**File:** `src/config.ts:99-125`
**Issue:**
```typescript
export const config: AgentConfig = {
  ...loadBehaviorConfig(),         // 第 1 次读盘
  ...
  feishu: {
    pushMode: loadBehaviorConfig().feishu?.pushMode || 'lark_channel',    // 第 2 次
    receiveMode: loadBehaviorConfig().feishu?.receiveMode || 'reaction',  // 第 3 次
    chatId: loadBehaviorConfig().feishu?.chatId || '',                    // 第 4 次
  },
};
```

Three problems:
1. `loadBehaviorConfig()` is invoked **four times** at module load — each does `existsSync` + `readFileSync` + `JSON.parse` + spread. I/O is cheap but this is wasteful and error-prone: if `agent-config.json` is edited between calls (e.g. by a concurrent process) the four reads can disagree.
2. The phase's central W2 fix ("嵌套对象显式字段级合并，防部分配置致 undefined 阈值") was applied to `consolidation` but **completely ignored for `feishu`**. If the user writes `"feishu": { "pushMode": "webhook" }` (only one field), `loadBehaviorConfig().feishu?.receiveMode` is `undefined` → falls back to `'reaction'` silently; `chatId` becomes `''`. More subtly, the spread at line 100 (`...loadBehaviorConfig()`) already puts `feishu: { pushMode: 'webhook' }` into `config`, but then lines 120-124 **overwrite** `config.feishu` with the manually reconstructed object — so the first `loadBehaviorConfig()` result for `feishu` is discarded entirely.
3. `chatId` in `data/agent-config.json:50` is `"oc_ed5e44e2a607673f93096e50ae086315"` — a real Lark chat ID checked into the repo. Not a credential per se, but it is sensitive operational data that should not be in version control.

**Fix:**
```typescript
const behavior = loadBehaviorConfig(); // 读一次
const defaultFeishu = { pushMode: 'lark_channel' as const, receiveMode: 'reaction' as const, chatId: '' };
export const config: AgentConfig = {
  ...behavior,
  llmModel: process.env.LLM_MODEL || 'deepseek-chat',
  // ...env-only fields...
  feishu: {
    ...defaultFeishu,
    ...(behavior.feishu ?? {}), // 嵌套字段级合并，与 consolidation 一致
  },
};
```
Also: move `chatId` to `.env` (`LARK_CHAT_ID`) and remove from `agent-config.json`.

---

### CR-05: `appendWanderHistory` 非原子写 + 硬编码相对路径，破坏测试隔离与崩溃一致性

**File:** `src/agent/react.ts:76-77, 109-124`
**Issue:**
```typescript
const WANDER_HISTORY_PATH = 'data/wander-history.json';   // 硬编码，忽略 DATA_DIR
...
await writeFile(WANDER_HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
```
1. **Non-atomic write**: `writeFile` truncates then writes. A crash mid-write leaves a partial JSON file; next `appendWanderHistory` calls `JSON.parse(raw)` (react.ts:114) which will throw on partial content. The `try/catch` at line 121 then logs a warn and **silently drops the entire existing history** because `history` stays `[]`. This is a data-loss bug under crash.
2. **Hard-coded path** ignores `process.env.DATA_DIR` and the project's `getDataPath()` helper (config.ts:172). Tests using `useTempDataDir()` set `DATA_DIR` to a tmp path, but `WANDER_HISTORY_PATH` still points at the real `data/wander-history.json` — meaning test runs **pollute real production data** (or fail if cwd lacks write permission).
3. The phase's memory-index module deliberately uses temp-file + `rename` for atomicity (memory-index.ts:114-117). The same standard must apply here.

**Fix:**
```typescript
import { rename, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { getDataPath } from '../config.js';

const WANDER_HISTORY_FILE = 'wander-history.json';
const MAX_WANDER_HISTORY_ENTRIES = 100;

async function appendWanderHistory(steps: WanderStep[]): Promise<void> {
  const fullPath = getDataPath(WANDER_HISTORY_FILE);
  let history: WanderStep[] = [];
  if (existsSync(fullPath)) {
    const raw = await readFile(fullPath, 'utf-8');
    history = JSON.parse(raw); // 解析失败应抛错而非兜底空数组（符合 CLAUDE.md 红线）
  }
  history.push(...steps);
  if (history.length > MAX_WANDER_HISTORY_ENTRIES) {
    history = history.slice(-MAX_WANDER_HISTORY_ENTRIES);
  }
  // 原子写：temp + rename
  const tmp = `${fullPath}.tmp`;
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(tmp, JSON.stringify(history, null, 2), 'utf-8');
  await rename(tmp, fullPath);
}
```

---

### CR-06: `react.ts` 重试全失败后仍写入 `totalWanders+1`，将失败计入成功统计

**File:** `src/agent/react.ts:183-223, 264-273`
**Issue:**
The retry loop:
```typescript
for (let attempt = 0; attempt <= maxRetries; attempt++) {
  try { await generateText({...}); break; }
  catch (error) {
    logger.error(...);
    if (attempt === maxRetries) {
      ctx.endReason = 'error';
    }
    // 没有 return / throw / continue — 进入下一次 attempt
  }
}
```
On total failure (all attempts exhausted), the loop exits normally and execution continues into the state-update block (react.ts:264-273), which writes:
```typescript
totalWanders: state.totalWanders + 1,
totalSteps: state.totalSteps + ctx.stepCount,
```
So a fully-failed wander (no LLM call ever succeeded) increments `totalWanders` by 1. The only signal of failure is `consecutiveFailures: state.consecutiveFailures + 1` — but `totalWanders` is now permanently inflated. Dashboards / observability that read `totalWanders` will over-count.

Worse, `result.spokeTimes`, `result.steps`, `result.visitedUrls` are all 0 / empty in the failure case, but the function returns successfully (no throw), so the caller (`runHeartbeat` in index.ts:255) logs "本次游荡结束" as if normal.

**Fix:** On terminal failure, either throw (preferred — let `runHeartbeat`'s catch log it), or skip the success-accounting state update:
```typescript
} catch (error) {
  logger.error(`[${ctx.traceId}] LLM 调用异常 (attempt ${attempt + 1}/${maxRetries + 1})`, { error });
  if (attempt === maxRetries) {
    ctx.endReason = 'error';
    // 仅记 consecutiveFailures，不计 totalWanders（失败不算一次游荡）
    await updateState({
      consecutiveFailures: state.consecutiveFailures + 1,
    });
    return {
      steps: 0,
      durationMs: Date.now() - startTime,
      spokeTimes: 0,
      visitedUrls: [],
      endReason: 'error',
    };
  }
}
```

---

## Warnings

### WR-01: `archive.ts` 永远追加 `.md`，破坏文件名身份 + 重复扩展名

**File:** `src/memory/long-term/archive.ts:52`
**Issue:**
```typescript
const destFilename = `${toSafeFilename(basename(sourcePath))}.md`;
```
Source path is always `<id>.md` (set by `MemoryStore.saveMemory` index.ts:256). After `toSafeFilename` (which strips/replaces the `.` in `.md` → `xxx-md`) and then re-appending `.md`, the archived file becomes `xxx-md.md`. The test at `consolidate.test.ts:270` literally asserts this: `expect(archived).toContain('test-arch-xyz-md.md')`. The test was written to match the bug rather than catch it.

Problems:
1. The archived filename no longer matches the original `id` — any future "restore from archive" feature cannot trivially reverse the rename.
2. If `archiveFile` is ever called twice on the same id (e.g. consolidated, then someone re-runs), both `xxx-md.md` writes collide silently (second overwrites first).

**Fix:** Strip the extension before sanitizing, then add it back:
```typescript
const base = basename(sourcePath).replace(/\.md$/, '');
const destFilename = `${toSafeFilename(base)}.md`;
```
Update the test to assert `test-arch-xyz.md` (not `-md.md`).

---

### WR-02: 合并阈值默认值散落三处，违反 CLAUDE.md「No Magic Values」

**File:** `src/config.ts:58-63` (defaultBehavior.consolidation), `src/memory/long-term/consolidate.ts:127-129, 256`, `src/memory/long-term/types.ts:66-72`
**Issue:**
The same four thresholds (`lowImportanceThreshold`, `expiryDays`, `mergeMaxAgeDays`, `urlCleanupDays`) have independent hardcoded fallbacks in:
1. `config.ts:defaultBehavior.consolidation` — authoritative source.
2. `consolidate.ts:127` — `?? config.consolidation?.lowImportanceThreshold ?? 0.2` (literal `0.2`).
3. `consolidate.ts:129` — `?? config.consolidation?.mergeMaxAgeDays ?? 7` (literal `7`).
4. `consolidate.ts:256` — `?? config.consolidation?.expiryDays ?? 60` (literal `60`).
5. `src/index.ts:73` — `config.consolidation?.urlCleanupDays ?? 30` (literal `30`).

If a default ever changes in `config.ts`, the other 4 sites will silently revert to the old literal on `undefined`. This is exactly the failure mode the W2 嵌套合并 fix was designed to prevent — but the consolidation fallbacks still tolerate `undefined`. Once W2 guarantees `config.consolidation` is always fully populated, these `?? 0.2 / ?? 7 / ?? 60 / ?? 30` literals are dead code that mislead future readers.

**Fix:** Trust W2 — make `config.consolidation` non-optional (`MemoryConsolidationConfig`, not `?`), then drop the `?? literal` fallbacks:
```typescript
const lowImportanceThreshold = options.minImportance ?? config.consolidation.lowImportanceThreshold;
const maxAgeDays = options.maxAgeDays ?? config.consolidation.mergeMaxAgeDays;
// etc.
```
And update `types.ts:168` `consolidation?: {...}` → `consolidation: {...}` so TypeScript enforces presence.

---

### WR-03: `archiveFile` 路径遍历防护有漏 — `toSafeFilename` 对绝对路径调用方未约束

**File:** `src/memory/long-term/types.ts:89-104`, `src/memory/long-term/archive.ts:52`
**Issue:**
`archiveFile` does:
```typescript
const destFilename = `${toSafeFilename(basename(sourcePath))}.md`;
const destPath = join(archiveDir, destFilename);
```
`basename` is applied first, so `../etc/passwd` → `passwd`, then `toSafeFilename('passwd')` → `passwd`. That part is fine. But:
1. The function takes `sourcePath: string` with no constraint that it lives under `basePath`. A caller passing `/etc/passwd` (absolute, outside `basePath`) would have it `stat`-checked (passes — file exists), then `rename`'d into `.archive/<type>/passwd-md.md` — i.e., `archiveFile` can be used to **move arbitrary OS files into the archive directory**.
2. `toSafeFilename` allows CJK characters (`一-龥` in regex types.ts:83). Not a security issue, but means filenames can be very long after concatenation (no length cap applied before the `.md` append).

There is no current caller passing arbitrary paths, but as a library API this is a latent foot-gun. The defensive fix is cheap.

**Fix:** Validate `sourcePath` is inside `basePath` before any filesystem mutation:
```typescript
import { resolve, relative } from 'path';
const resolvedSource = resolve(sourcePath);
const resolvedBase = resolve(basePath);
const rel = relative(resolvedBase, resolvedSource);
if (rel.startsWith('..') || isAbsolute(rel)) {
  throw new Error(`archiveFile 源路径越界: ${sourcePath} 不在 basePath ${basePath} 之内`);
}
```

---

### WR-04: `selectMemoriesByTokenBudget` 复杂度过高且含魔法数字 `30`

**File:** `src/memory/long-term/index.ts:479-502`
**Issue:**
- Inline literal `30` used as "markdown overhead" at lines 493, 496 — duplicated, magic number, violates CLAUDE.md.
- Inside a `for...of` over sorted candidates, `selected.reduce(...)` runs every iteration → O(n²).
- Method is 24 lines but does three things (sort, loop, accumulate), with a nested reduce inside the loop body — readability / cyclomatic smell.
- `maxChars = maxTokens * 2.5` — another magic literal.

**Fix:** Extract constants and precompute accumulated length:
```typescript
const MARKDOWN_OVERHEAD_CHARS = 30;
const CHARS_PER_TOKEN = 2.5;
// ...
const sorted = [...memories].sort((a, b) => b.score - a.score);
let used = 0;
const selected: MemoryEntry[] = [];
for (const m of sorted) {
  const len = m.content.length + m.summary.length + m.tags.join(' ').length + MARKDOWN_OVERHEAD_CHARS;
  if (used + len <= maxTokens * CHARS_PER_TOKEN) {
    selected.push(m);
    used += len;
  }
}
return selected;
```

---

### WR-05: `parseTypeStats` 静默兜底违反 CLAUDE.md 红线

**File:** `src/memory/long-term/index.ts:224-231`
**Issue:**
```typescript
private parseTypeStats(str: string): Record<MemoryType, number> {
  try {
    return JSON.parse(str);
  } catch (error) {
    consola.warn('解析 typeStats 失败，计数器回退为 0', { raw: str, error });
    return { profile: 0, knowledge: 0, interaction: 0, observation: 0 };
  }
}
```
This directly violates the project CLAUDE.md red line: "错误就是错误，失败就该报错，不能用默认值掩盖". `typeStats` is written by `formatIndexToMarkdown` (index.ts:203) via `JSON.stringify` — it should always parse. If it doesn't, INDEX.md has been corrupted/tampered with, and returning zeros silently masks the corruption (next `saveMemory` will increment from 0, permanently understating totals). The sibling `readIndex` correctly throws on bad title — this method should follow the same pattern.

Separately, there is no validation that the parsed object actually has the 4 MemoryType keys — `JSON.parse('null')` returns `null`, `JSON.parse('{}')` returns `{}`, and both would then cause `index.typeStats[type]` to be `undefined` downstream (in `updateIndexAfterSave` at index.ts:585, `undefined + 1 = NaN`).

**Fix:**
```typescript
private parseTypeStats(str: string): Record<MemoryType, number> {
  if (!str) return { profile: 0, knowledge: 0, interaction: 0, observation: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(str);
  } catch (error) {
    throw new Error(`typeStats 解析失败（INDEX.md 已损坏）: ${str}`, { cause: error });
  }
  // 结构校验
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`typeStats 非对象: ${str}`);
  }
  const obj = parsed as Record<string, unknown>;
  const result = { profile: 0, knowledge: 0, interaction: 0, observation: 0 };
  for (const key of Object.keys(result) as MemoryType[]) {
    const v = obj[key];
    if (typeof v !== 'number') {
      throw new Error(`typeStats.${key} 非数字: ${String(v)}`);
    }
    result[key] = v;
  }
  return result;
}
```

---

### WR-06: `INDEX.md` 概览区中文 key 无法被 `parseIndexFromMarkdown` 往返解析

**File:** `src/memory/long-term/index.ts:176-180, 195-219`
**Issue:**
`formatIndexToMarkdown` writes:
```
- 总记忆数: 5
- 类型统计: {...}
```
But `parseIndexFromMarkdown`'s meta regex is `/^\s*-\s*(\w+):\s*(.+)$/` (index.ts:176). `\w` does **not** match CJK characters, so `总记忆数` and `类型统计` are silently dropped during round-trip. The test at `index.test.ts:103-105` documents this bug explicitly:
```typescript
// NOTE: totalMemories / typeStats 因概览区中文 key ... 无法往返——已作为独立
// 发现报告，不在本测试提交中修复，故此处不断言以避免误绿。
```
Effect: any time `INDEX.md` is rewritten by `writeIndex` then re-read by `readIndex`, `totalMemories` resets to 0 and `typeStats` resets to all-zeros. Since `updateIndexAfterSave` (index.ts:582) calls `readIndex()` at the start of every save, **every save resets `totalMemories` to 0 before incrementing to 1**, regardless of how many memories actually exist. The reported count is permanently wrong.

This is labeled WARNING rather than CRITICAL because `totalMemories` is observability-only (no logic branches on it), but it does mean the dashboard / stats are lying.

**Fix:** Use ASCII keys consistently, or broaden the regex:
```typescript
// Option A: write ASCII keys
'- totalMemories: ...',
'- typeStats: ...',
// Option B: broaden regex to accept CJK
const metaMatch = line.match(/^\s*-\s*([^:]+):\s*(.+)$/);
```

---

### WR-07: `extractAccessedAt` / `parseMemoryFrontmatter` 对 frontmatter 中 `accessedAt` 字段处理不一致

**File:** `src/memory/long-term/consolidate.ts:44-49, 273-285`, `src/memory/long-term/types.ts:137-171`, `src/memory/long-term/memory-index.ts:43-49`
**Issue:**
Three different parsers with three different behaviors for `accessedAt`:
1. `parseMemoryFrontmatter` (types.ts:137) **discards** `accessedAt` entirely — it's not in the returned object.
2. `extractAccessedAt` (consolidate.ts:44) does its own regex `/accessedAt:\s*(.+)/` on raw content (no `m` flag, so it can match anywhere — though `^` anchored).
3. `extractAccessedAtFromContent` (memory-index.ts:43) does `/^accessedAt:\s*(.+)$/m` (multiline-anchored).
4. `getMemory` (index.ts:311) reads it via `jsonIndex.getAccessedAt` only.

If a Markdown file has `accessedAt: 2026-01-01` in frontmatter but the JSON index lacks the record, `cleanupExpired` (consolidate.ts:282) uses `extractAccessedAt(content) || parsed.timestamp`. The `extractAccessedAt` regex lacks the `m` flag — it will fail to match if `accessedAt` is not on the first line of `content`. Since `content` here is the full Markdown (frontmatter + body) and `accessedAt` typically appears after `importance:` (line 5+), the regex will match (because `.` matches any char except newline and the value is on the same line) — so it happens to work. But the inconsistency is brittle.

**Fix:** Single source of truth — have `parseMemoryFrontmatter` return `accessedAt` too, then delete the two custom extractors:
```typescript
// types.ts parseMemoryFrontmatter return:
return {
  timestamp: ...,
  accessedAt: meta.accessedAt || null, // 新增
  tags: ...,
  // ...
};
```
Then `memory-index.ts:150` becomes `accessedAt: parsed.accessedAt ?? parsed.timestamp`, and `consolidate.ts:282` becomes `accessedAt = parsed.accessedAt || parsed.timestamp`.

---

### WR-08: `MemoryStore.getMemory` 在读路径上 fire-and-forget 更新 `accessedAt`（race）

**File:** `src/memory/long-term/index.ts:305-313`
**Issue:**
```typescript
await this.jsonIndex.touchAccessedAt(type, id).catch((error) => {
  logger.warn('更新索引 accessedAt 失败', { id, error });
});
const indexed = await this.jsonIndex.getAccessedAt(type, id);
entry.accessedAt = indexed ?? entry.timestamp;
```
- `touchAccessedAt` mutates in-memory store but does NOT call `persist()`. The updated `accessedAt` is lost on process restart unless some later code happens to `persist()` (e.g. a `saveMemory` happens). For a read-heavy / write-light workload this means accessedAt tracking silently doesn't survive restarts — the very data `cleanupExpired` depends on.
- The `catch(...)` swallows errors and continues — but then immediately reads `getAccessedAt` which may return the stale value. Silent staleness.

**Fix:** Either persist on `touchAccessedAt` (write amplification, but consistent), or batch flush on a timer / shutdown hook. At minimum, document why persist is intentionally deferred.

---

### WR-09: `recordWanderSummary` / `buildMemoryPromptContext` 使用模块级 `getMemoryStore()` 单例，绕过 DI

**File:** `src/memory/long-term/write.ts:13`, `src/memory/long-term/read.ts:13`
**Issue:**
```typescript
// write.ts:13
const store = getMemoryStore();
// read.ts:13
const store = getMemoryStore();
```
Module-load time binding to the singleton. Tests that construct `new MemoryStore({ basePath: tmpDir })` and call methods directly work fine, but the production `recordWanderSummary(...)` and `buildMemoryPromptContext()` called from `react.ts` always hit the global singleton whose `basePath` is the hardcoded `'data/memory'` (DEFAULT_MEMORY_CONFIG.basePath). This means:
1. `DATA_DIR` env var (used by `useTempDataDir` test helper) does not redirect these calls — they always read/write `data/memory/`.
2. There is no way to inject a test store without monkey-patching the module.

The consolidation module accepts `store?` in its constructor (consolidate.ts:59) — this is the correct pattern. The read/write modules should match.

**Fix:** Pass the store as a parameter:
```typescript
export async function recordWanderSummary(
  params: {...},
  store: MemoryStore = getMemoryStore(),
): Promise<void> { ... }
```

---

### WR-10: `mergeTopicMemories` 按 filename 子串匹配 topic，脆弱且易误并

**File:** `src/memory/long-term/consolidate.ts:202-207`
**Issue:**
```typescript
const topicLower = toSafeFilename(topic).toLowerCase();
const topicFiles = files.filter(
  (f) => f.includes(topicLower) && f.endsWith('.md'),
);
```
`saveMemory` generates ids like `knowledge-<timestamp>-<hash>` (types.ts:113) — the filename **never contains the topic** unless the LLM happens to include the topic word in `content` such that the sha hash starts with those characters (cryptographically impossible). So in production, `mergeTopicMemories('llm')` matches zero files. The test at `consolidate.test.ts:63-80` works only because it manually writes files with names like `knowledge-llmtopic-aaa.md`, bypassing `saveMemory`.

Additionally, `f.includes(topicLower)` will match topic `cat` against `category-xxx.md` and `educational-yyy.md` — substring collision causing unrelated memories to be merged.

**Fix:** Index by `tags` or by an explicit topic field. Topic-merge should query `jsonIndex.queryRecent({ type: 'knowledge' })` then filter where `tags` includes the topic or `summary/content` contains it (with word boundaries).

---

### WR-11: `consolidate.test.ts` 嵌套合并测试用动态 import 破坏 ESM 缓存，不稳定

**File:** `src/memory/long-term/consolidate.test.ts:308-331`
**Issue:**
```typescript
const configMod = await import(`../../config.ts?t=${Date.now()}`);
```
This relies on `Date.now()` producing a unique query string to bypass ESM module cache. Problems:
1. ESM spec does not guarantee this bypasses cache — Bun's behavior may differ from Node's, and future runtime versions may cache more aggressively.
2. The dynamic import path `../../config.ts` is fragile to file moves.
3. `config.ts` has side effects at module load (calls `loadBehaviorConfig()` 4x, reads env) — re-importing it can re-trigger those side effects unpredictably.
4. Test pollutes `data/agent-config.json` by writing to it (line 311-318) — `useTempDataDir()` only redirects if `config.ts` honors `DATA_DIR`, which the W2 fix did not address for `CONFIG_PATH = 'data/agent-config.json'` (config.ts:4 hard-coded).

**Fix:** Make `loadBehaviorConfig` a pure function accepting a path, and unit-test that directly:
```typescript
test('部分 consolidation 配置时其它字段仍取默认值', () => {
  const result = mergeBehaviorConfig(
    { consolidation: { expiryDays: 10 } },
    defaultBehavior,
  );
  expect(result.consolidation.expiryDays).toBe(10);
  expect(result.consolidation.lowImportanceThreshold).toBe(0.2);
  // ...
});
```

---

## Info

### IN-01: `stats.ts` recordStep 在 catch 中静默吞所有异常，无日志

**File:** `src/llm/stats.ts:58-60`
**Issue:**
```typescript
} catch {
  // 计数自愈：回调内异常被 SDK 静默吞，这里 catch 后不抛、不记日志
}
```
The comment justifies not logging ("避免循环调用 logger") but the project's CLAUDE.md says "禁止 silent fail / 空 catch". At minimum an `if (DEBUG)` log or a counter of swallowed errors would aid debugging. Not a correctness issue (the function is documented as no-throw), but it violates project conventions.

**Fix:** Increment a module-level `swallowedErrors` counter exposed via `getLLMStats()` so observability can detect chronic issues without logging in the catch.

---

### IN-02: `react.ts` 删除了原 `speak` 调用但保留了 `lastSpoke` 计算

**File:** `src/agent/react.ts:246-256`
**Issue:**
```typescript
const lastSpoke = ctx.wanderHistory.filter((s) => s.spoke).pop();
await recordWanderSummary({
  ...
  spoke: lastSpoke?.spoke || '（本次未分享）',
  ...
});
```
If no speak happened, `spoke` falls back to the literal `'（本次未分享）'` and is persisted as memory content. This is a **magic string** persisted to long-term memory, violating No Magic Values. Downstream `buildMemoryContext` will inject this literal into every future prompt.

**Fix:** Either skip `recordWanderSummary` when nothing was spoken, or extract to a named constant `const NO_SPOKE_MARKER = '（本次未分享）'` and tag the memory so it can be filtered out of context injection.

---

### IN-03: `MemoryStore.searchMemories` 被改造后未走索引，仍 O(N) 全扫

**File:** `src/memory/long-term/index.ts:353-363`
**Issue:**
```typescript
async searchMemories(query: string): Promise<MemoryEntry[]> {
  const allMemories = await this.getRecentMemories({ count: 100 });
  ...
}
```
After the JSON index refactor, `searchMemories` still fetches the top 100 by recency then filters in-memory. This is (a) O(N) over the recent 100, (b) **ignores memories older than the top 100 by recency**, so a search for an old topic returns nothing. The phase brief explicitly mentions `keywords[]` as a forward improvement, but the current code has no keyword index — so search is silently scoped to recent-only.

Not a regression (this was the prior behavior), but worth flagging since the phase is about索引 infra.

**Fix:** Either document the recency-cap in the JSDoc, or push the query into `jsonIndex.queryRecent` with a keyword filter once `MemoryIndexRecord` gains a `keywords` field.

---

### IN-04: `validateConfig` 未校验 `consolidation` 阈值范围

**File:** `src/config.ts:146-164`
**Issue:**
`validateConfig` checks for missing env vars but does not validate that `config.consolidation.lowImportanceThreshold` is in `[0,1]`, that `expiryDays > 0`, etc. A user typo like `"lowImportanceThreshold": -1` or `"expiryDays": "abc"` would silently propagate: `entry.importance < -1` is always false (no cleanup ever happens), and `expiryDays * DAY_MS` with a string yields `NaN`, making `cutoff = Date.now() - NaN = NaN`, so `new Date(accessedAt).getTime() < NaN` is always false → no cleanup ever happens.

**Fix:** Add a Zod schema for the consolidation block (mirroring `MemoryJsonIndexSchema` pattern) and run it in `loadBehaviorConfig`.

---

### IN-05: 多个模块超 300 行 — 违反 CLAUDE.md 文件大小上限

**File:** `src/memory/long-term/index.ts` (619 lines), `src/memory/long-term/consolidate.ts` (349 lines), `src/agent/react.ts` (283 lines), `src/memory/long-term/consolidate.test.ts` (333 lines)
**Issue:**
CLAUDE.md specifies "文件超 400 行时主动拆分" and the project's core rules say "类/模块 ≤ 300 行". `index.ts` is over 600 lines and mixes: Markdown INDEX.md CRUD, MemoryEntry CRUD, context-building, token-budgeting, and JSON index delegation. `consolidate.ts` at 349 lines mixes容量检查、合并、过期清理、D-04 双记.

**Fix:** Split `index.ts` into:
- `store.ts` (MemoryStore class + entry CRUD)
- `index-md.ts` (INDEX.md read/write/parse)
- `context-builder.ts` (buildMemoryContext + scoring + token budget)
- keep `memory-index.ts` as-is.

Split `consolidate.ts` into `consolidator.ts` (class) + `cleanup-observations.ts` (D-04 helper).

---

_Reviewed: 2026-06-20T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
