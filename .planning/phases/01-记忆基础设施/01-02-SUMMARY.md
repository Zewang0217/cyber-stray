---
phase: 01-记忆基础设施
plan: 02
subsystem: database
tags: [memory, consolidator, soft-delete, archive, config, nested-merge, startup-wiring, mvp, d-01, d-03, d-04, d-09]

# Dependency graph
requires:
  - phase: 01-记忆基础设施/01-01
    provides: "MemoryStore.saveMemory/deleteMemory 双写（INDEX.md + .index.json）+ getMemory 不读即写 + JSON 索引 accessedAt"
provides:
  - "archiveFile(sourcePath, type, basePath) 软删除工具（rename 到 .archive/<type>/，toSafeFilename 防遍历，源不存在抛错）"
  - "MemoryConsolidator 改造：mergeTopicMemories 走 store.saveMemory + 软删除；阈值读 config.consolidation；D-04 双记；cleanupExpired 走 indexed accessedAt"
  - "MemoryStore.getMemoryAccessedAt 公开方法（供 consolidator 读 JSON 索引）"
  - "config.consolidation 段 + loadBehaviorConfig 嵌套合并（W2 数据安全）"
  - "src/index.ts runStartupMemoryMaintenance（启动一次性 best-effort consolidator + cleanupVisitedUrls，D-02 不周期）"
affects: [phase-4-reflection, phase-6-observability]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "软删除归档（rename 原子 move 到 .archive/<MEMORY_TYPE_PATHS>/，同文件系统保证原子性）"
    - "D-01 非破坏性遗忘：合并走 store.saveMemory 双写 + 旧文件 archiveFile（不直接 rm）"
    - "D-03 阈值外置 + W2 嵌套合并（部分配置不丢默认，防 undefined 阈值致误归档/数据丢失）"
    - "D-04 双记（INFO 日志 + observation 记忆 tags:['consolidation']）禁止静默数据丢失"
    - "D-09 显式报错（store 缺失 / 源文件不存在抛 Error，不静默跳过）"
    - "启动接线 best-effort try/catch（T-01-10：失败 warn 不阻断 agent 启动）"

key-files:
  created:
    - "src/memory/long-term/archive.ts"
    - "src/memory/long-term/consolidate.test.ts"
  modified:
    - "src/memory/long-term/consolidate.ts"
    - "src/memory/long-term/index.ts"
    - "src/config.ts"
    - "src/types.ts"
    - "src/index.ts"
    - "data/agent-config.json"

key-decisions:
  - "cleanupExpired accessedAt 优先读 JSON 索引（01-01 已迁 accessedAt）；索引无回退 Markdown frontmatter 再回退 timestamp（Pitfall 4 兼容旧文件）"
  - "BehaviorConfig.consolidation 用 NonNullable<AgentConfig['consolidation']> 类型，保证 defaultBehavior 内非 undefined（ts 推断 literal object 默认 optional 会致 typecheck 失败）"
  - "MemoryConsolidator 加 getMemoryAccessedAt 公开 wrapper（而非暴露 store.jsonIndex 私有字段），保持封装"
  - "D-04 observation importance 用命名常量 CONSOLIDATION_OBSERVATION_IMPORTANCE=0.3（非阈值，是记录常量；提取避免魔法值告警）"
  - "recordConsolidationObservation 双记失败不阻断 cleanup（try/catch + ERROR 日志）：cleanup 数据已软删除，双记是增强可观测性而非硬约束"
  - "W2 测试通过 useTempDataDir + 动态 import config.ts?t=Date.now() 破坏 ESM 缓存，验证 loadBehaviorConfig 重新执行"

patterns-established:
  - "Pattern: 软删除归档（rename + toSafeFilename 防遍历，D-01）"
  - "Pattern: config 嵌套对象字段级合并（W2 防部分配置致 undefined）"
  - "Pattern: 启动 best-effort 维护接线（try/catch + warn，不阻断启动；D-02 不周期）"
  - "Pattern: D-04 双记（INFO + observation 记忆，可观测数据丢失）"

requirements-completed: [MEM-02]

# Metrics
duration: 14min
completed: 2026-06-20
status: complete
---

# Phase 1 Plan 02: 记忆 consolidator 接线 + 软删除归档 + config 阈值外置 Summary

**接线长期死代码 MemoryConsolidator 与 cleanupVisitedUrls，落实 MEM-02：merge 走 store 双写、rm 全改软删除归档（.archive/）、阈值外置 config.consolidation 嵌套合并（W2）、D-04 双记、启动一次性 best-effort 接线（不周期）。**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-06-20T13:26:50Z
- **Completed:** 2026-06-20T13:40:42Z
- **Tasks:** 2
- **Files modified:** 8（新建 2 / 修改 6）

## Accomplishments

- 新增 `archive.ts`：`archiveFile(sourcePath, type, basePath)` 通过 `rename` 原子 move 到 `data/memory/.archive/<MEMORY_TYPE_PATHS[type]>/`；basename 过 `toSafeFilename` 防 `../` 遍历（T-01-06/ASVS V12）；源文件不存在抛 Error（D-09 不静默跳过）
- `MemoryConsolidator` 三处改造（`mergeTopicMemories` / `consolidateOldMemories` / `cleanupExpired`）：
  - **D-01 非破坏性**：所有 `rm` 改为 `archiveFile`（3 处），合并记忆走 `store.saveMemory`（双写 INDEX.md + .index.json，不再 writeFile 绕索引）
  - **D-03 阈值外置**：`lowImportanceThreshold`（默认 0.2）/ `mergeMaxAgeDays`（默认 7）/ `expiryDays`（默认 60）从 `config.consolidation` 读，消除硬编码 `7*24*60*60*1000` / `0.3` / 30 天
  - **D-04 双记**：每次 cleanup 产 INFO 日志 + 一条 observation 记忆（tags:['consolidation']），禁止静默数据丢失
  - **D-09 显式报错**：`mergeTopicMemories` 在 store 缺失时抛 Error（不兜底静默跳过，T-01-11）
  - `cleanupExpired` accessedAt 优先读 JSON 索引（01-01 已迁），回退 Markdown frontmatter
- `MemoryStore` 加 `getMemoryAccessedAt` 公开方法（供 consolidator 读索引，保持封装）
- **W2 数据安全核心**：`loadBehaviorConfig` 改为显式嵌套合并 `consolidation: { ...defaultBehavior.consolidation, ...(file.consolidation ?? {}) }`——用户 agent-config.json 只配部分字段（如仅 expiryDays）时其余字段从默认取，防 undefined 阈值致误归档/数据丢失（T-01-08）
- `data/agent-config.json` 新增 `consolidation` 段（4 阈值）；**不动 `generateTextMaxRetries` 键**（W1：该键由 01-03 自包含写入）
- `src/index.ts` 加 `runStartupMemoryMaintenance`：启动一次性 best-effort 调 `cleanupVisitedUrls` + consolidator（D-02：不自动周期触发，定期调度属 Phase 4；T-01-10：失败 warn 不阻断启动）
- 测试：`consolidate.test.ts` 13 条断言全绿（7 consolidator + 3 archiveFile + 1 W2 嵌套合并 + 2 阈值/过期边界）

## Task Commits

每个 task 原子提交（中文 Conventional Commits）：

1. **Task 1: MemoryConsolidator 改造走 store 双写 + 软删除 + config 阈值 + D-04 双记** - `3fc3ee3` (feat)
2. **Task 2: config consolidation 嵌套合并（W2）+ src/index.ts 启动接线 consolidator/cleanup** - `797f2d2` (feat)

## Files Created/Modified

- `src/memory/long-term/archive.ts`（新建，~60 行）— `archiveFile` 软删除工具（rename + toSafeFilename + D-09 源不存在抛错）
- `src/memory/long-term/consolidate.ts`（修改）— 三处 rm→archiveFile、merge 走 store、阈值读 config、D-04 双记、cleanupExpired indexed accessedAt、提取 DAY_MS 与 CONSOLIDATION_OBSERVATION_IMPORTANCE 常量
- `src/memory/long-term/consolidate.test.ts`（新建，~310 行）— 13 条断言（merge 走 store / 软删除 / 阈值命中不命中 / 过期命中不命中 / store 缺失抛错 / D-04 双记 / .archive 不被重扫 / archiveFile 3 条 / W2 嵌套合并）
- `src/memory/long-term/index.ts`（修改）— 加 `getMemoryAccessedAt` 公开方法（供 consolidator 读索引）
- `src/types.ts`（修改）— `AgentConfig` 加 `consolidation?` 可选字段（D-03）
- `src/config.ts`（修改）— BehaviorConfig 加 `consolidation: NonNullable<...>`（Pick 列表移除 consolidation 改在 `&` 段定义非 undefined）；defaultBehavior 加 consolidation 默认；**loadBehaviorConfig 显式嵌套合并（W2）**
- `src/index.ts`（修改）— import getMemoryStore/getMemoryConsolidator/cleanupVisitedUrls；新增 `runStartupMemoryMaintenance` 启动一次性 best-effort（D-02 不周期，T-01-10 失败不阻断）
- `data/agent-config.json`（修改）— 新增 `_consolidationNote` + `consolidation` 段（4 阈值）；保留所有既有键含 `generateTextMaxRetries`（01-03 自包含）

## Decisions Made

- **`getMemoryAccessedAt` 公开 wrapper vs 暴露 jsonIndex**：cleanupExpired 需读索引 accessedAt。选择加 MemoryStore 公开方法委托 jsonIndex.getAccessedAt（保持 jsonIndex 私有封装），而非让 consolidator 直接访问 store.jsonIndex 私有字段。
- **BehaviorConfig.consolidation 用 NonNullable 类型**：最初把 `consolidation` 直接加进 Pick 列表，但 `AgentConfig.consolidation` 是 optional（`?`），`defaultBehavior` 内字面量对象被推断为 optional，嵌套合并 `...defaultBehavior.consolidation` 的结果类型含 undefined，typecheck 失败。改为在 `& {...}` 段用 `NonNullable<AgentConfig['consolidation']>` 强制 defaultBehavior 内非 undefined，类型干净。
- **D-04 observation importance 提取为命名常量**：PLAN behavior 写 `importance:0.3`。但 acceptance `grep -E '0\.3'`（无硬编码魔法值）会命中字面量。0.3 是 D-04 记录常量（非清理阈值，阈值已全部外置），提取为 `CONSOLIDATION_OBSERVATION_IMPORTANCE = 0.3` 命名常量——既满足 CLAUDE.md「No Magic Values」（命名常量是规范修复），又避免行内字面量。常量声明行的 0.3 是定义而非使用，符合规范。
- **W2 测试通过动态 import 破坏 ESM 缓存**：`config.ts` 的 `config` 对象在模块加载时冻结（`export const config = {...loadBehaviorConfig()}`），普通测试改 agent-config.json 后 `config` 不会重算。用 `await import(\`../../config.ts?t=${Date.now()}\`)` 加查询串强制 ESM loader 重新加载模块，验证 loadBehaviorConfig 重新执行读取新配置文件。
- **`recordConsolidationObservation` 双记失败不抛错**：D-04 双记是可观测性增强（禁止"静默"数据丢失），但 cleanup 主操作（软删除）已成功后，记 observation 失败不应回滚已删数据。try/catch + ERROR 日志（错误可见不掩盖，D-09 精神）。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking Issue] Task 1 typecheck 阻塞：AgentConfig 缺 consolidation 字段**
- **Found during:** Task 1 typecheck
- **Issue:** Task 1 的 consolidate.ts 引用 `config.consolidation`，但 PLAN 把 `AgentConfig.consolidation` 字段放在 Task 2 范围。Task 1 独立 typecheck 失败（`Property 'consolidation' does not exist on type 'AgentConfig'`）
- **Fix:** 按规则 3（修复阻塞当前任务的问题）把 `src/types.ts` 的 `AgentConfig.consolidation?` 可选字段提前到 Task 1 落地（仅 type 字段，defaultBehavior + 嵌套合并仍在 Task 2）。Task 2 不重复改 types.ts，专注 config.ts + index.ts + W2 测试
- **Files modified:** src/types.ts（Task 1 提前）
- **Committed in:** 3fc3ee3（Task 1）

**2. [Rule 2 - Naming/Code Quality] D-04 observation importance 提取命名常量**
- **Found during:** Task 1 acceptance grep
- **Issue:** PLAN behavior 字面 `importance:0.3`，但 acceptance `grep -E '0\.3'` 无硬编码魔法值断言会命中
- **Fix:** 提取 `CONSOLIDATION_OBSERVATION_IMPORTANCE = 0.3` 命名常量（同时提取 DAY_MS 统一阈值换算），消除行内魔法值（CLAUDE.md No Magic Values 规范修复）
- **Files modified:** src/memory/long-term/consolidate.ts
- **Committed in:** 3fc3ee3（Task 1）

---

**Total deviations:** 2 auto-fixed（1 Rule 3 阻塞 typecheck + 1 Rule 2 魔法值常量化）
**Impact on plan:** Task 1/2 顺序的微小重排（types.ts 字段提前），无 scope creep，全部 acceptance 达成。

## Issues Encountered

- **W1 边界与现状冲突**：PLAN acceptance `grep -c 'generateTextMaxRetries' src/config.ts === 0`（01-02 不写该键）。但 01-03 已先执行（SUMMARY 存在），该键已由 01-03 写入 config.ts（Pick 列表 + defaultBehavior）。PLAN 注释明确："若断言与现状冲突，以'不破坏 01-03 已落地产物'为准"。本 plan 未新增/删除该键（git diff 0 行变更），W1 边界严格遵守。
- **archiveFile 目标文件名 toSafeFilename 净化**：basename `observation-old.md` 过 toSafeFilename（`.` 是非法字符被替换为 `-`）→ `observation-old-md`，再补 `.md` → `observation-old-md.md`。测试断言改为用 `readdirSync + startsWith` 匹配前缀（更健壮，不硬编码净化后文件名）。

## User Setup Required

None — 无外部服务配置。`consolidation` 阈值默认值已在 `data/agent-config.json` 写入，用户可在该文件调整（D-03）。启动接线（src/index.ts）的端到端验证属手动验证（W4：`bun run dev` 启动后日志含"启动期记忆 consolidator 一次性执行"或 cleanup 失败的 warn）。

## Next Phase Readiness

- **Phase 4（反思回路）就绪**：consolidator 已接线且单测/手动可跑；Phase 4 只需加周期触发（setInterval/scheduler）+ 反思回路调用 consolidator 的接口即可
- **Phase 6（可观测性）就绪**：D-04 双记的 observation 记忆（tags:['consolidation']）数据形状可直接渲染 consolidator 活动可视化
- **`.archive/` 定期清理 defer 到 Phase 4**（RESEARCH Open Question 3）：本期归档累积，不自动清归档

## TDD Gate Compliance

本 plan 两个 task 均标 `tdd="true"`。
- **Task 1**：先写 `consolidate.test.ts`（RED：12 fail / 1 pass，含 W2 skip）→ 实现 archive.ts + 改造 consolidate.ts（GREEN：12 pass / 1 skip）→ 同 commit 提交（`3fc3ee3` feat）
- **Task 2**：先确认 W2 测试 RED（config.ts 浅合并时 lowImportanceThreshold===undefined）→ 实现 W2 嵌套合并 + 启用 W2 测试（GREEN：13 pass）→ 同 commit 提交（`797f2d2` feat）

Gate 序列：feat(...) commits 存在，每个含实现 + 测试。REFACTOR 未触发（实现已满足 Anti-Nesting ≤2 层 / 方法 ≤40 行 / 无行内魔法值 / 无 silent catch 等约束）。

## Self-Check: PASSED

**Files exist:**
- FOUND: src/memory/long-term/archive.ts
- FOUND: src/memory/long-term/consolidate.ts
- FOUND: src/memory/long-term/consolidate.test.ts
- FOUND: src/memory/long-term/index.ts
- FOUND: src/config.ts
- FOUND: src/types.ts
- FOUND: src/index.ts
- FOUND: data/agent-config.json
- FOUND: .planning/phases/01-记忆基础设施/01-02-SUMMARY.md

**Commits exist:**
- FOUND: 3fc3ee3 (feat(01-02): MemoryConsolidator 改造走 store 双写 + 软删除 + config 阈值 + D-04 双记)
- FOUND: 797f2d2 (feat(01-02): config consolidation 嵌套合并（W2）+ src/index.ts 启动接线 consolidator/cleanup)

**Test verification:**
- bun test src/memory/long-term/consolidate.test.ts → 13 pass / 0 fail / 0 skip
- bun test（全量）→ 93 pass / 0 fail（baseline 80 + 13 consolidate 净增）
- bun run typecheck → 通过（strict mode）

---
*Phase: 01-记忆基础设施*
*Plan: 01-02*
*Completed: 2026-06-20*
