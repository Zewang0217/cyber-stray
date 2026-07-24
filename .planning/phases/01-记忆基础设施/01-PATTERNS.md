# Phase 1: 记忆基础设施 - Pattern Map

**Mapped:** 2026-06-20
**Files analyzed:** 12（新建 4 / 修改 6 / 测试 3，含共享夹具复用）
**Analogs found:** 12 / 12（全部命中现有代码或就近同级模块）

> 本期是 **Brownfield 重构**（无新项目脚手架），所有新建文件都在既有目录内、复用既有模块级单例 + 文件系统持久化 + Zod/Bun test 栈。下方代码摘录来自真实代码，含文件路径与行号，供 planner 直接拷入 PLAN 的 action 区。

## File Classification

| 新建/修改文件 | Role | Data Flow | Closest Analog | Match Quality |
|----------------|------|-----------|----------------|---------------|
| `src/memory/long-term/memory-index.ts`（新建） | service / store | CRUD（JSON sidecar 索引读写） | `src/memory/long-term/index.ts`（`MemoryStore` 的 `readIndex`/`writeIndex`/`updateIndexAfterSave`）+ `src/tools/dedup/url-tracker.ts`（JSON sidecar `loadVisitedUrls`/`saveVisitedUrls`/`createDefaultStore` + `version` 字段） | exact（双来源拼合） |
| `src/memory/long-term/archive.ts`（新建） | utility | file-I/O（move 到 `.archive/`） | `src/memory/long-term/index.ts:330` `deleteMemory`（`rm` 路径改为 `rename` 到归档） | role-match |
| `data/memory/.index.json`（新建数据产物） | config / data-artifact | file-I/O | `data/dedup/visited-urls.json`（既有 JSON sidecar，含 `version`/`records`/`lastCleanup`） | exact |
| `data/memory/.archive/`（新建目录） | data-artifact | file-I/O | `data/dedup/` 目录布局（`getDataPath(DEDUP_DIR)` + `mkdir {recursive:true}`） | role-match |
| `src/memory/long-term/index.ts`（修改） | service / store | CRUD | 自身（`getMemory` :257 / `getRecentMemories` :282 / `saveMemory` :230 / `deleteMemory` :330 / `readIndex` :62 / `updateIndexAfterSave` :519） | exact（就地改造） |
| `src/memory/long-term/consolidate.ts`（修改） | service | transform（合并）/ batch（清理） | 自身（`mergeTopicMemories` :165 / `cleanupExpired` :217 / `consolidateOldMemories` :103） | exact（就地改造） |
| `src/memory/long-term/types.ts`（修改） | model | —（schema 扩展） | 自身 `MemoryIndex`(:23) / `MemoryConfig`(:44) / `DEFAULT_MEMORY_CONFIG`(:53) | exact |
| `src/tools/dedup/url-tracker.ts:179`（修改，接线 `cleanupVisitedUrls`） | utility | batch（清理） | 自身 `cleanupVisitedUrls`（:179） | exact |
| `src/agent/react.ts`（修改） | controller / orchestrator | request-response（ReAct loop） | 自身 `runAgentLoop`（:135，含强制 speak :223 / stats 包装 :182/199 / STAT 块 :206） | exact |
| `src/llm/stats.ts`（修改） | service / state | event-driven（`onStepEnd` 回调驱动） | 自身 `startLLMCall`/`endLLMCall`/`getLLMStats`（模块级状态） | exact |
| `src/index.ts`（修改，接线 consolidator + cleanup 入口） | controller（启动钩子） | event-driven（启动调用） | 自身 `main()`(:15) / `runHeartbeat()`(:165) | role-match（接线点） |
| `data/agent-config.json`（修改，加 `consolidation` 阈值段） | config | — | 自身 `urlCooldownDays`(:52) 字段 + `_xxxNote` 注释段 | exact |
| `src/memory/long-term/memory-index.test.ts`（新建测试） | test | — | `src/memory/long-term/index.test.ts` + `src/tools/dedup/url-tracker.test.ts`（持久化分组） | exact |
| `src/memory/long-term/consolidate.test.ts`（新建测试） | test | — | `src/memory/long-term/index.test.ts`（`mkdtempSync`+`new MemoryStore({basePath:dir})`） | exact |
| 扩展 `src/agent/react.test.ts` / `index.test.ts`（测试） | test | — | 自身（已有 `useTempDataDir`/`mockFetchError` 夹具用法） | exact |

## Pattern Assignments

### `src/memory/long-term/memory-index.ts`（新建，service/CRUD）

**Analog A:** `src/memory/long-term/index.ts`（`MemoryStore` 的索引读写骨架）
**Analog B:** `src/tools/dedup/url-tracker.ts`（JSON sidecar 的 load/save/default 三件套 + `version` 字段）

**Imports pattern**（仿 `src/memory/long-term/index.ts:10-30` + `src/tools/dedup/url-tracker.ts:10-13`）:
```typescript
import { readFile, writeFile, mkdir, rename } from 'fs/promises';  // rename 用于原子写（D-Pitfall 3）
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { consola } from '../../logger.js';
import type { MemoryEntry, MemoryType } from './types.js';
```

**JSON sidecar load/save + version 字段 pattern**（照搬 `url-tracker.ts:40-104`，含 `createDefaultStore` + 缺失字段补全 + `version` 兜底）:
```typescript
// Source: src/tools/dedup/url-tracker.ts:40-46, 77-104
function createDefaultIndex(): MemoryJsonIndex {
  return { version: 1, lastUpdated: new Date().toISOString(), records: [] };
}

export async function loadJsonIndex(path: string): Promise<MemoryJsonIndex> {
  if (!existsSync(path)) {
    const fresh = createDefaultIndex();
    await saveJsonIndex(path, fresh);
    return fresh;
  }
  try {
    const content = await readFile(path, 'utf-8');
    const store = JSON.parse(content) as MemoryJsonIndex;
    // 缺失字段补全（防 schema 漂移，对齐 Pitfall 5）
    if (!store.version) store.version = 1;
    if (!store.records) store.records = [];
    return store;
  } catch (error) {
    // ★D-09 区分：not found 返默认（上面分支）；解析失败抛错（不兜底返默认）
    logger.error('加载 JSON 索引失败', { path, error });
    throw new Error(`JSON 索引解析失败: ${path}`, { cause: error });
  }
}
```

**原子写 pattern**（RESEARCH.md Pattern 2；`url-tracker.ts:109-113` 现状是非原子 `writeFile`，**本期必须升级为 temp+rename**）:
```typescript
// Source: RESEARCH.md Pattern 2（Context7 /oven-sh/bun 核实 POSIX rename 原子）
async function saveJsonIndex(path: string, data: MemoryJsonIndex): Promise<void> {
  const tmp = `${path}.tmp`;  // 同目录保证同文件系统（rename 原子性前提）
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await rename(tmp, path);
}
```

**索引钩子接线 pattern**（照搬 `MemoryStore.updateIndexAfterSave` 骨架 `index.ts:519-539`，三写扩展）:
```typescript
// Source: src/memory/long-term/index.ts:519-539（既有 INDEX.md 双写钩子点，JSON 第三写挂这里）
private async updateIndexAfterSave(entry: MemoryEntry): Promise<void> {
  // 既有：写 INDEX.md（人类可读）
  await this.updateIndexMarkDown(entry);
  // ★新增：写 .index.json（查询索引，原子）
  await this.jsonIndex.upsert(entry);
}
```

**Error handling pattern**（D-09：区分 not found vs 解析失败，改 `index.ts:72-75` 的 silent catch）:
```typescript
// ✗ 现状（src/memory/long-term/index.ts:72-75）——读取/解析失败静默返默认，违反红线：
//   catch (error) { logger.error('读取索引失败，使用默认索引', { error });
//     return this.createDefaultIndex(); }
// ★改为：not found 返默认（合法空值）；解析失败抛错（D-09）
```

---

### `src/memory/long-term/archive.ts`（新建，utility/file-I/O）

**Analog:** `src/memory/long-term/index.ts:330` `deleteMemory`（把 `rm` 改为 `rename` 到 `.archive/<type>/`）

**软删除归档 pattern**（替代 `consolidate.ts:131/237` 的直接 `rm`；路径用 `toSafeFilename` 防遍历，仿 `types.ts:76-91`）:
```typescript
// Source: 改造 src/memory/long-term/consolidate.ts:131/237（rm → archive move）
import { rename, mkdir } from 'fs/promises';
import { join } from 'path';
import { toSafeFilename } from './types.js';  // 复用既有防遍历（types.ts:76）

export async function archiveFile(
  sourcePath: string,
  type: MemoryType,
  basePath: string,
): Promise<void> {
  const archiveDir = join(basePath, '.archive', MEMORY_TYPE_PATHS[type]);
  await mkdir(archiveDir, { recursive: true });           // 仿 url-tracker.ts:67-70
  const dest = join(archiveDir, `${toSafeFilename(basename(sourcePath))}.md`);
  await rename(sourcePath, dest);                          // 同文件系统原子 move
}
```

**注意：** `.archive/` 必须**不在** `MEMORY_TYPE_PATHS`（`types.ts:62-67`），现状 `getRecentMemories`（`index.ts:290-305`）与 `consolidate.ts:62/89` 已只扫 `MEMORY_TYPE_PATHS` 显式子目录——新代码须显式依赖此约定，禁用通配扫描（RESEARCH Pitfall 6 / A3）。

---

### `data/memory/.index.json`（新建数据产物，config/data-artifact）

**Analog:** `data/dedup/visited-urls.json`（既有 JSON sidecar 实物）

**Shape pattern**（照搬 `url-tracker.ts:28-32` 的 `version`/`records`/`lastCleanup` 三段式 + RESEARCH Pitfall 5 的 `version:1` 防漂移）:
```json
{
  "version": 1,
  "lastUpdated": "2026-06-20T00:00:00.000Z",
  "records": [
    {
      "id": "knowledge-1718...-abcd1234",
      "type": "knowledge",
      "timestamp": "2026-06-20T...",
      "accessedAt": "2026-06-20T...",
      "importance": 0.6,
      "tags": ["ai", "llm"],
      "summary": "DeepSeek V4 开源",
      "filepath": "knowledge/knowledge-1718...-abcd1234.md"
    }
  ]
}
```

> `accessedAt` 从 Markdown frontmatter 迁此（RESEARCH Pitfall 4：`rebuildIndexFromMarkdown()` 时先解析 `parseMemoryFrontmatter` 的 `accessedAt`，写入索引；之后停写 Markdown 的 accessedAt）。

---

### `src/memory/long-term/index.ts`（修改，service/CRUD）

**Analog:** 自身（就地改造，落点已逐行锁定）

**`getMemory` 不再读即写**（改 `index.ts:257-277`）:
```typescript
// ✗ 现状（index.ts:264-272）：读后 writeFile 重写文件 bump accessedAt（写放大 + 并发读冲突）
//   const content = await readFile(filepath, 'utf-8');
//   const entry = this.parseMemoryFromMarkdown(content, id, type);
//   entry.accessedAt = new Date().toISOString();
//   const updatedContent = this.formatEntry(entry);
//   await writeFile(filepath, updatedContent, 'utf-8');
// ★改为：accessedAt 迁索引；读路径不写文件（RESEARCH Example 4）
```

**`readIndex` catch 显式化**（改 `index.ts:62-76`）：见上文 memory-index.ts 的 Error handling pattern（D-09）。

**`getRecentMemories` 改走索引**（改 `index.ts:282-310`，消除 O(N) `readdir`+全文件读）:
```typescript
// ✗ 现状（index.ts:290-305）：for t in types { readdir(dir); for file in files { getMemory(t, file) } }
// ★改为：从 .index.json 查表 → 仅按需 readFile 命中条目（O(1) 索引查表）
```

**`deleteMemory` catch 显式化 + 索引联动**（改 `index.ts:330-353`）：现状 `return false`（:333 not found / :351 异常）混为一谈，须按 D-09 区分。

---

### `src/memory/long-term/consolidate.ts`（修改，service/transform+batch）

**Analog:** 自身（`MemoryConsolidator` 死代码接线 + 三处改造）

**`mergeTopicMemories` 走 store**（改 `consolidate.ts:165-212`，D-01）:
```typescript
// ✗ 现状（consolidate.ts:200-209）：writeFile 绕 store + rm 旧文件（索引不同步 + 不可逆）
//   const mergedPath = join(dir, `${topicLower}-merged.md`);
//   await writeFile(mergedPath, formatMemoryToMarkdown(merged), 'utf-8');
//   for (const file of topicFiles) { await rm(join(dir, file)); }
// ★改为（RESEARCH Example 5）：
//   await this.store.saveMemory(merged);            // 双写 INDEX.md + .index.json
//   for (const file of topicFiles) { await archiveFile(join(dir, file), 'knowledge', this.basePath); }
```

**阈值外置**（D-03，消除 `consolidate.ts:108` 硬编码 `7 * 24 * 60 * 60 * 1000` / `0.3` 与 `:218` 的 `maxAge`）:
```typescript
// ✗ 现状（consolidate.ts:108）：const { maxAge = 7*24*60*60*1000, minImportance = 0.3 } = options;
// ★改为：读 config.consolidation.{lowImportanceThreshold, expiryDays, mergeMaxAgeDays}
//        沿用 config.ts:59-69「缺失字段回退默认」模式（见 Shared Patterns / Config）
```

**INFO 日志 + observation 记忆双记**（D-04，扩 `consolidate.ts:147/248` 的 INFO 日志）:
```typescript
// 既有（consolidate.ts:147）：logger.info(`清理了 ${deletedCount} 条低价值旧记忆`);
// ★扩为：INFO 日志 + store.saveMemory({ type:'observation', tags:['consolidation'], ... })
//        数据形状对齐 Phase 6 可渲染（RESEARCH D-04）
```

**接线（死代码）**：`getMemoryConsolidator`（:267）当前仅被 barrel `src/memory/long-term.ts:42` re-export，**零调用点**。在 `src/index.ts` 加手动调用（不自动触发，D-02）。

---

### `src/tools/dedup/url-tracker.ts:179`（修改，utility/batch）

**Analog:** 自身 `cleanupVisitedUrls`（死代码接线）

**接线 pattern**：`cleanupVisitedUrls`（:179）当前零调用点。在 `src/index.ts` 启动钩子按 D-02 手动调（`cleanupVisitedUrls(config.consolidation.urlCleanupDays)`），不自动周期触发。

**阈值外置**（D-03）：现状签名 `cleanupVisitedUrls(daysToKeep: number)` 已是参数化（良好），调用方从 `config.consolidation.urlCleanupDays` 读即可。

---

### `src/agent/react.ts`（修改，controller/request-response）

**Analog:** 自身 `runAgentLoop`（:135）

**废除强制 speak**（删 `react.ts:222-229`，D-05/D-06/D-07）:
```typescript
// ✗ 删除整块（react.ts:223-229）：
//   if (ctx.spokeTimes === 0 && ctx.visitedUrls.length > 0) {
//     const lastUrl = ctx.visitedUrls[ctx.visitedUrls.length - 1];
//     await speak(`刚才出去溜达了一圈...`, 'nonsense').catch(...);
//   }
// ★STAT 块（:206-220）已含 speakCount，空游荡自动可见（D-07：进统计不推送）
```

**按步计数 onStepEnd**（改 `react.ts:182-200`，D-11/D-10）:
```typescript
// ✗ 现状（react.ts:182-200）：startLLMCall() 包整次 generateText → calls 恒为 1
//   startLLMCall();
//   try { await generateText({ ... }); }
//   catch (error) { ... ctx.endReason = 'error'; }
//   finally { endLLMCall(); }
// ★改为（RESEARCH Example 2）：
let attempt = 0;
const maxRetries = config.generateTextMaxRetries ?? 1;  // D-10 默认 1
for (attempt = 0; attempt <= maxRetries; attempt++) {
  try {
    await generateText({
      model: provider.chat(config.llmModel),
      temperature: config.wanderTemperature,
      system: systemPrompt, prompt: initialUserPrompt,
      stopWhen: [hasToolCall('rest'), stepCountIs(maxSteps)],
      tools,
      onStepEnd({ stepNumber, usage, performance }) {
        // ⚠回调内抛错被 SDK 静默吞（RESEARCH Pitfall 1）——计数逻辑只做纯内存累加
        try { recordStep({ stepNumber, promptTokens: usage?.promptTokens,
          completionTokens: usage?.completionTokens, totalTokens: usage?.totalTokens,
          durationMs: performance?.totalMs ?? 0 }); }
        catch { /* 计数自愈，不阻断主流程 */ }
      },
    });
    break;
  } catch (error) {
    logger.error(`[${ctx.traceId}] LLM 调用异常 (attempt ${attempt + 1}/${maxRetries + 1})`, { error });
    if (attempt === maxRetries) ctx.endReason = 'error';
  }
}
```

---

### `src/llm/stats.ts`（修改，service/event-driven）

**Analog:** 自身 `startLLMCall`/`endLLMCall`/`getLLMStats`（模块级状态）

**改 recordStep(usage) API**（RESEARCH Example 1，替换 `startLLMCall`/`endLLMCall`）:
```typescript
// ✗ 现状（stats.ts:18-37）：let calls: CallRecord[]; startLLMCall/endLLMCall 手工配对
// ★改为：onStepEnd 驱动的纯累加
export interface StepRecord {
  stepNumber: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  durationMs: number;
}
let steps: StepRecord[] = [];
export function recordStep(rec: StepRecord): void { steps.push(rec); }
export function getLLMStats(): LLMStats {
  const calls = steps.length;
  const totalMs = steps.reduce((s, r) => s + r.durationMs, 0);
  const totalTokens = steps.reduce((s, r) => s + (r.totalTokens ?? 0), 0);
  const avgMs = calls > 0 ? Math.round(totalMs / calls) : 0;
  return { calls, totalMs, avgMs, totalTokens };  // 可选扩 totalTokens 字段
}
export function resetLLMStats(): void { steps = []; }
```

**保留：** `resetLLMStats` 在 `react.ts:141` 的调用不变；`getLLMStats` 在 `react.ts:203` 的调用不变。

---

### `src/index.ts`（修改，controller 启动钩子）

**Analog:** 自身 `main()`(:15) / `runHeartbeat()`(:165)

**Consolidator + cleanup 接线 pattern**（D-02：代码可达但不自动触发，加手动入口或启动一次性调用）:
```typescript
// 落点：src/index.ts main() 内 validateConfig() 之后、startHeartbeat() 之前
// 或：暴露为独立 CLI 子命令（bun run src/index.ts --consolidate）
//   本期不自动周期触发（D-02），定期调度留 Phase 4 反思周期
import { getMemoryConsolidator } from './memory/long-term.js';
import { cleanupVisitedUrls } from './tools/dedup/url-tracker.js';
// 手动入口：const removed = await cleanupVisitedUrls(config.consolidation.urlCleanupDays);
```

---

### `data/agent-config.json`（修改，config）

**Analog:** 自身 `urlCooldownDays`(:52) + `_xxxNote` 注释段（:50）

**阈值外置 pattern**（D-03，仿现有 `_urlCooldownNote` + `urlCooldownDays` 结构）:
```json
"_consolidationNote": "记忆合并/清理阈值（D-03）。保守默认：先跑通不误删",
"consolidation": {
  "lowImportanceThreshold": 0.2,
  "expiryDays": 60,
  "mergeMaxAgeDays": 7,
  "urlCleanupDays": 30
},
"generateTextMaxRetries": 1
```

**Config 读取**：沿用 `config.ts:59-69` `loadBehaviorConfig()` 的 `{ ...defaultBehavior, ...file }` 合并（见 Shared Patterns）。

---

### `src/memory/long-term/types.ts`（修改，model）

**Analog:** 自身 `MemoryIndex`(:23) / `MemoryConfig`(:44) / `DEFAULT_MEMORY_CONFIG`(:53)

**Schema 扩展 pattern**（仿既有 interface + DEFAULT 模式）:
```typescript
// 新增：JSON sidecar schema（供 Zod 校验，RESEARCH V5 Input Validation）
export interface MemoryIndexRecord {
  id: string;
  type: MemoryType;
  timestamp: string;
  accessedAt: string;
  importance: number;
  tags: string[];
  summary: string;
  filepath: string;
}
export interface MemoryJsonIndex {
  version: 1;
  lastUpdated: string;
  records: MemoryIndexRecord[];
}
// 扩展 MemoryConfig：加 consolidation 阈值字段（D-03）
```

---

### 测试文件（新建 + 扩展，test）

**Analog A（夹具）:** `src/test/helpers.ts`（`useTempDataDir` / `mockChatCompletion` / `mockFetchError` / `makeState`）——**全部复用，无需新增夹具**（RESEARCH Validation Architecture 已确认）。
**Analog B（存储测试结构）:** `src/memory/long-term/index.test.ts`（`mkdtempSync` + `new MemoryStore({basePath:dir})` + `beforeEach/afterEach` rmSync）。
**Analog C（持久化分组结构）:** `src/tools/dedup/url-tracker.test.ts`（"纯函数" + "持久化" 两个 describe 分组，`useTempDataDir` 隔离）。

**Test scaffold pattern**（照搬 `index.test.ts:1-19`）:
```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('MemoryIndex', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'memidx-test-'));
    // 或用共享夹具：const { cleanup } = useTempDataDir();
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
  // ...memory-index.test.ts: 双写 / 原子写 / 重建 / 索引命中
  // ...consolidate.test.ts: merge 走 store / 软删除 / 阈值 / 过期
});
```

**react.test.ts 扩展 pattern**（照搬 `react.test.ts:1-44`，复用 `useTempDataDir`/`mockFetchError`/`_resetReactModuleState`）:
```typescript
// 扩展现有 describe('runAgentLoop')：
//   - 按步计数：mockChatCompletion 多步 → expect(getLLMStats().calls).toBeGreaterThan(1)
//   - 空游荡不推送：验证 speak 未被调（D-05）—— 须 mock speak 或断言 wanderHistory 无 spoke 节点
```

---

## Shared Patterns

### 模块级单例 get*()
**Source:** `src/memory/long-term/index.ts:545-552`（`getMemoryStore`）、`consolidate.ts:265-275`（`getMemoryConsolidator`）、`src/agent/react.ts:40-45`（`getProvider`）
**Apply to:** `memory-index.ts` 的 `getMemoryIndex()`、所有跨模块共享的 store/service 实例
```typescript
// Source: src/memory/long-term/index.ts:545-552
let defaultStore: MemoryStore | null = null;
export function getMemoryStore(): MemoryStore {
  if (!defaultStore) { defaultStore = new MemoryStore(); }
  return defaultStore;
}
```
**测试隔离：** 仿 `react.ts:66-69` `_resetReactModuleState()` 暴露测试用 reset 函数。

### Config 冻结于 import + 缺失字段回退默认
**Source:** `src/config.ts:32-69`（`defaultBehavior` + `loadBehaviorConfig` 的 `{ ...defaultBehavior, ...file }` 合并）
**Apply to:** D-03 所有 consolidator 阈值、D-10 `generateTextMaxRetries`
```typescript
// Source: src/config.ts:32, 59-69
const defaultBehavior: BehaviorConfig = { /* ...urlCooldownDays: 5, ... */ };
function loadBehaviorConfig(): BehaviorConfig {
  if (existsSync(CONFIG_PATH)) {
    try {
      const file = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Partial<BehaviorConfig>;
      return { ...defaultBehavior, ...file };  // 缺失字段回退默认
    } catch (err) { console.warn(`解析失败，用默认: ${err}`); }
  }
  return defaultBehavior;
}
```
**新增字段：** `consolidation.{lowImportanceThreshold, expiryDays, mergeMaxAgeDays, urlCleanupDays}` + `generateTextMaxRetries` 须扩 `BehaviorConfig` Pick 列表（:9-30）与 `defaultBehavior`。

### 数据路径解析（`getDataPath` + DATA_DIR 测试隔离）
**Source:** `src/config.ts:149-151`（`getDataPath` 读 `process.env.DATA_DIR`）
**Apply to:** `.index.json` / `.archive/` 路径解析；测试经 `useTempDataDir()`（`src/test/helpers.ts:97-115`，含 `chdir`）隔离
```typescript
// Source: src/config.ts:149-151
export function getDataPath(filename: string): string {
  return `${process.env.DATA_DIR ?? 'data'}/${filename}`;
}
```
**注意：** `MemoryStore` 现状用 `DEFAULT_MEMORY_CONFIG.basePath = 'data/memory'`（`types.ts:54`，相对路径），靠 `useTempDataDir` 的 `chdir`（`helpers.ts:101`）隔离——`.index.json` 落 `data/memory/` 下同理。

### 日志（consola withTag）
**Source:** 全模块（如 `index.ts:35` `consola.withTag('MemoryStore')`、`consolidate.ts:26`、`react.ts:17`、`url-tracker.ts:15`）
**Apply to:** 所有新模块；INFO 关键节点（D-04 cleanup）、ERROR 异常带上下文（id/操作/错误对象）、DEBUG 细节
```typescript
// Source: src/memory/long-term/consolidate.ts:26
const logger = consola.withTag('MemoryConsolidation');
// 用法：logger.info(`清理了 ${n} 条`, { topic }) / logger.error('读取失败', { id, error })
```

### AI SDK tool 包装（D-08 错误回喂）
**Source:** `src/agent/react.ts:180` `ToolManager.getTools(ctx)` + RESEARCH D-08
**Apply to:** ReAct 工具失败处理（本期不改工具，仅确认错误传播路径）
```typescript
// Source: src/agent/react.ts:180, 192-194
const tools = ToolManager.getTools(ctx);
await generateText({ /* ... */ stopWhen: [hasToolCall('rest'), stepCountIs(maxSteps)], tools });
// 工具 execute 抛错时 AI SDK 原生把结构化错误回喂 LLM（D-08，非兜底）
```

### 错误显式化（D-08/D-09 红线）
**Source:** `CLAUDE.md` §禁止随意兜底 + RESEARCH Anti-Patterns
**Apply to:** `getMemory`(:264-276) / `deleteMemory`(:349-352) / `readIndex`(:72-75) / memory-index.ts loadJsonIndex 的所有 catch
```typescript
// ✗ 禁止：catch (error) { logger.error(...); return null/默认; }  // 静默掩盖
// ★区分：not found → 返 null（合法空值）；读取/解析失败 → throw（不兜底）
```

## No Analog Found

**无。** 本期 12 个文件全部命中现有代码（就地改造）或就近同级模块（`url-tracker.ts` 的 JSON sidecar 模式给 `memory-index.ts`）。最"新"的 `onStepEnd` 回调 API 来自 RESEARCH.md（Context7 /vercel/ai 核实），其调用骨架（`generateText({ stopWhen, tools })`）仍复用 `react.ts:184-194` 现有结构。

## Metadata

**Analog search scope:**
- `src/memory/long-term/`（index.ts / consolidate.ts / types.ts / index.test.ts / write.ts / read.ts）
- `src/tools/dedup/url-tracker.ts`（+ .test.ts）—— JSON sidecar 主 analog
- `src/agent/react.ts`（+ .test.ts）—— ReAct loop + stats 包装主 analog
- `src/llm/stats.ts` —— 按步计数改造对象
- `src/config.ts`（+ .test.ts）—— config 回退模式
- `src/index.ts` —— consolidator/cleanup 接线点
- `src/test/helpers.ts` —— 共享测试夹具
- `data/agent-config.json` / `data/dedup/visited-urls.json` —— config 与 sidecar 实物

**Files scanned:** 14（含 2 个测试 analog + 2 个数据实物）
**Pattern extraction date:** 2026-06-20
**Brownfield note:** 全部改动落在既有文件或既有目录内新建文件，零新依赖、零新运行时。
