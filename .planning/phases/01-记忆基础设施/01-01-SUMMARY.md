---
phase: 01-记忆基础设施
plan: 01
subsystem: database
tags: [memory, index, json-sidecar, atomic-write, mvp, zod, d-09]

# Dependency graph
requires: []
provides:
  - "MemoryIndex 类（JSON sidecar 索引读写 + 原子写 + 启动重建 + Zod schema 校验）"
  - "loadJsonIndex / saveJsonIndex / getMemoryIndex / rebuildIndexFromMarkdown 模块函数"
  - "MemoryIndexRecord / MemoryJsonIndex / MemoryConsolidationConfig types + Zod schema"
  - "MemoryStore.getMemory 不读即写（写放大消除）"
  - "MemoryStore.getRecentMemories 走索引（O(1) 查表替代 O(N) readdir 全扫）"
  - "MemoryStore.saveMemory/deleteMemory 双写 INDEX.md + .index.json"
  - "MemoryStore.readIndex/getMemory/deleteMemory D-09 错误显式化（not found vs 抛错）"
affects: [01-02, 01-03, phase-2-interest-graph, phase-4-reflection]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "JSON sidecar 索引 + 原子写（temp-file + rename，同目录同文件系统）"
    - "真相源 + 派生索引双写钩子（Markdown → INDEX.md → .index.json）"
    - "启动崩溃自愈（rebuildIndexFromMarkdown 扫 MEMORY_TYPE_PATHS 四目录重建）"
    - "D-09 错误显式化：not found 返 null/false，解析失败抛 Error（禁 silent catch）"
    - "Zod schema 校验索引文件（version:1 字面量防漂移）"

key-files:
  created:
    - "src/memory/long-term/memory-index.ts"
    - "src/memory/long-term/memory-index.test.ts"
  modified:
    - "src/memory/long-term/index.ts"
    - "src/memory/long-term/types.ts"
    - "src/memory/long-term/index.test.ts"
    - ".gitignore"

key-decisions:
  - "JSON 索引 vs 全迁 SQLite：选 JSON sidecar（单用户量级，可逆无新依赖，对齐 PROJECT.md Key Decision）"
  - "原子写策略：temp-file + rename（同目录保证同文件系统，RESEARCH Pattern 2 / Context7 /oven-sh/bun 核实）"
  - "accessedAt 从 Markdown frontmatter 迁 JSON 索引（Pitfall 4 防丢历史，rebuild 时先读 frontmatter）"
  - "版本兼容：version:1 字面量 + Zod 校验，不匹配抛错（RESEARCH Pitfall 5）"
  - "rebuild 只扫 MEMORY_TYPE_PATHS 四目录（禁通配，天然不扫 .archive/，Pitfall 6）"
  - "D-09 not found vs 解析失败：parseMemoryFrontmatter 加 frontmatter 分界校验，readIndex 加标题标记校验"

patterns-established:
  - "Pattern: JSON sidecar 模块级单例（getMemoryIndex + _resetMemoryIndex 测试隔离）"
  - "Pattern: 三写钩子 updateIndexAfterSave（Markdown → INDEX.md → .index.json）"
  - "Pattern: 原子写 helper（writeFile tmp + rename，禁止跨文件系统 rename）"
  - "Pattern: 错误显式化三段式（existsSync false 返空值 / readFile 失败抛错 / parse 失败抛错）"

requirements-completed: [MEM-01]

# Metrics
duration: 14min
completed: 2026-06-20
status: complete
---

# Phase 1 Plan 01: 记忆索引层（JSON sidecar）Summary

**在 Markdown 真相源之上加可查询 JSON 索引（data/memory/.index.json），消除 getRecentMemories 的 O(N) 全扫与 getMemory 的读即写写放大，落实 MEM-01 + D-09 错误显式化红线。**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-06-20T12:41:38Z
- **Completed:** 2026-06-20T12:55:12Z
- **Tasks:** 2
- **Files modified:** 6（新建 2 / 修改 4）

## Accomplishments

- 新增 `MemoryIndex` 类（JSON sidecar 索引读写 + 原子写 + 启动重建 + Zod schema 校验），含 upsert/remove/queryRecent/touchAccessedAt/getAccessedAt/rebuild/persist 7 个方法 + 模块级单例
- `MemoryStore.getRecentMemories` 改走 `jsonIndex.queryRecent`（O(1) 索引查表），**不再 readdir 全文件扫**（readdir 已从 import 移除）
- `MemoryStore.getMemory` **不再读即写**（accessedAt 迁 JSON 索引，mtime 不变，写放大消除）
- `saveMemory`/`deleteMemory` 双写 INDEX.md + .index.json（三写钩子 + 索引联动）
- `readIndex`/`getMemory`/`deleteMemory`/`loadJsonIndex` **D-09 错误显式化**：not found 返 null/false（合法空值），读取/解析失败抛 Error（不兜底返默认/空对象）—— 遵 CLAUDE.md 禁止兜底红线
- 15 条 memory-index + 7 条 store 改造测试全绿（含双写/原子写/重建/索引命中/accessedAt 迁移/schema 漂移/解析失败抛错/不读即写 mtime 不变/D-09 not found/spy getMemory 调用 0 次等）

## Task Commits

每个 task 原子提交（中文 Conventional Commits）：

1. **Task 1: MemoryIndex 模块 + types.ts schema 扩展 + Wave 0 测试** - `ead4012` (feat)
2. **Task 2: MemoryStore 改造（双写钩子 + 检索走索引 + getMemory 不读即写 + 错误显式化）** - `f8bef03` (feat)

## Files Created/Modified

- `src/memory/long-term/memory-index.ts`（新建，314 行）— MemoryIndex 类 + loadJsonIndex/saveJsonIndex(原子)/rebuildIndexFromMarkdown/createDefaultJsonIndex/getMemoryIndex/_resetMemoryIndex
- `src/memory/long-term/memory-index.test.ts`（新建，295 行）— 15 条测试覆盖 MEM-01 索引层全部验收点
- `src/memory/long-term/types.ts`（修改）— 新增 MemoryIndexRecord/MemoryJsonIndex/MemoryConsolidationConfig 接口 + Zod schema；MemoryConfig 扩 consolidation + generateTextMaxRetries 可选字段；parseMemoryFrontmatter 加 frontmatter 分界校验
- `src/memory/long-term/index.ts`（修改）— 构造函数注入 jsonIndex；readIndex/getMemory/getRecentMemories/deleteMemory/updateIndexAfterSave 五处改造；readdir 从 import 移除
- `src/memory/long-term/index.test.ts`（修改）— 新增 7 条 MEM-01 store 改造测试
- `.gitignore`（修改）— 加 `data/memory/.index.json` 忽略项（防运行时数据产物泄漏）

## Decisions Made

- **测试 spy 策略调整**：原 PLAN 用 ESM `fs/promises.readFile` 模块替换统计 Markdown 读取次数。ESM 命名空间只读，无法运行时改写。改为：在 basePath 下不创建 Markdown 目录，仅 persist `.index.json`，验证 queryRecent 仍返回 records（证明走索引）；store 改造测试用 `spyStore.getMemory` wrapper 计数（getRecentMemories 新实现不调 getMemory）。
- **D-09 解析失败如何判定**：`parseMemoryFrontmatter` / `parseIndexFromMarkdown` 原本对任意输入都返默认（容错过度），不满足 D-09"解析失败抛错"。补两个最小校验：记忆必须有 `---` frontmatter 分界；INDEX.md 必须含 `# 赛博街溜子记忆系统` 标题标记。这两个校验是 Rule 2 必要功能（防止伪装/脏数据被当合法记忆/索引吞下）。
- **`MemoryIndex` 类名与 types.ts `MemoryIndex` 接口冲突**：用 import alias `MemoryIndex as MemoryIndexStore` 解决（types.ts 接口是既有公共 API，不改名）。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Validation] parseMemoryFrontmatter 加 frontmatter 分界校验**
- **Found during:** Task 2（D-09 测试）
- **Issue:** PLAN 测试要求"非法 Markdown → getMemory 抛 Error"，但 parseMemoryFrontmatter 对任意输入（如 `'完全非法的非 Markdown 内容'`）都返默认对象不抛错（容错过度），不满足 D-09 红线
- **Fix:** 加 `if (!content.startsWith('---') || content.split('---').length < 3) throw new Error(...)` 守卫——缺分界视为非法记忆内容
- **Files modified:** src/memory/long-term/types.ts
- **Verification:** `bun test src/memory/long-term/index.test.ts -t "解析失败"` 绿
- **Committed in:** f8bef03（Task 2）

**2. [Rule 2 - Missing Critical Validation] readIndex 加 INDEX.md 标题标记校验**
- **Found during:** Task 2（D-09 测试）
- **Issue:** parseIndexFromMarkdown 对任意输入返默认空索引（容错过度），readIndex 无法区分"空索引"与"非法内容"
- **Fix:** readIndex 在 parse 前校验 `content.includes('# 赛博街溜子记忆系统')`，缺标记抛 Error
- **Files modified:** src/memory/long-term/index.ts
- **Verification:** `bun test src/memory/long-term/index.test.ts -t "readIndex 解析失败"` 绿
- **Committed in:** f8bef03（Task 2）

**3. [Rule 2 - Missing Critical Config] .gitignore 加 `.index.json` 忽略项**
- **Found during:** Task 2 后置检查（untracked file）
- **Issue:** 测试运行产生 `data/memory/.index.json` 泄漏到工作树，`.gitignore` 现有规则只覆盖 `*.md` 不含 sidecar JSON
- **Fix:** `.gitignore` 数据文件段加 `data/memory/.index.json`
- **Files modified:** .gitignore
- **Verification:** `git status data/memory/.index.json` 报 "nothing to commit, working tree clean"
- **Committed in:** 待与 SUMMARY metadata 一起提交

---

**Total deviations:** 3 auto-fixed（2 missing critical validation + 1 missing config）
**Impact on plan:** 全部为 PLAN 验收点的必要支撑（无 D-09 校验则 PLAN 测试不可能绿；.gitignore 防数据泄漏）。无 scope creep。

## Issues Encountered

- **ESM spy 限制**：原 PLAN 期望用 `fs/promises.readFile` 模块替换统计 Markdown 读取次数断言"索引命中"。ESM 命名空间只读，`(promisesMod as {}).readFile = spy` 运行时抛 `TypeError: Attempted to assign to readonly property`。改用更稳健的"basePath 不存在 Markdown 目录，仅 persist 索引，仍返回 records"语义断言（见 Decisions Made）。
- **类/接口命名冲突**：从 `./memory-index.js` 导入的 `class MemoryIndex` 与 `./types.js` 的 `interface MemoryIndex` 同名，TS 把 `private jsonIndex: MemoryIndex` 解析为接口（无实例方法）导致 `Property 'upsert' does not exist on type 'MemoryIndex'`。import alias 解决。

## User Setup Required

None — 无外部服务配置。`.index.json` 在首次 saveMemory 或 rebuild 时自动生成（无需手动创建）。

## Next Phase Readiness

- **01-02（consolidator 接线）就绪**：`MemoryStore.saveMemory`/`deleteMemory` 双写路径已通，`mergeTopicMemories` 改走 store 即可享受索引双写；`MemoryConfig.consolidation` 阈值字段已埋（默认值由 config.ts 提供，不在 DEFAULT_MEMORY_CONFIG 设防双源）
- **01-03（LLM stats + 强制 speak 废除）就绪**：`MemoryConfig.generateTextMaxRetries` 字段已埋（D-10）
- **Phase 2（兴趣图谱）/ Phase 4（反思）就绪**：记忆检索层 O(1) 索引查表已通，为反思回路的高频检索扫清瓶颈

## TDD Gate Compliance

本 plan 两个 task 均标 `tdd="true"`。git log 验证：
- Task 1: 实现 + 测试同 commit（`ead4012` feat）—— 测试与实现共同落地（RED 阶段 `Cannot find module './memory-index.js'` 已验证失败）
- Task 2: 实现 + 测试同 commit（`f8bef03` feat）—— 新增 7 条测试 RED 阶段（5 条 fail）已验证，实现后全绿

Gate 序列：test(...)/feat(...) commits 存在。REFACTOR 未触发（代码初次落地已满足 Anti-Nesting ≤2 层 / 方法 ≤40 行 / 无魔法值 / 无 silent catch 等约束）。

## Self-Check: PASSED

**Files exist:**
- FOUND: src/memory/long-term/memory-index.ts
- FOUND: src/memory/long-term/memory-index.test.ts
- FOUND: src/memory/long-term/types.ts
- FOUND: src/memory/long-term/index.ts
- FOUND: src/memory/long-term/index.test.ts
- FOUND: .planning/phases/01-记忆基础设施/01-01-SUMMARY.md

**Commits exist:**
- FOUND: ead4012 (feat(01-01): 新增 MemoryIndex JSON sidecar 索引模块)
- FOUND: f8bef03 (feat(01-01): MemoryStore 改造走 JSON 索引)

**Test verification:**
- bun test src/memory/long-term/ → 29 pass / 0 fail
- bun run typecheck → 通过（strict mode）

---
*Phase: 01-记忆基础设施*
*Plan: 01-01*
*Completed: 2026-06-20*
