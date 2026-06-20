---
phase: 01-记忆基础设施
plan: 03
subsystem: agent
tags: [react-loop, llm-stats, onstepfinish, speak, error-handling, retry, mvp]

# Dependency graph
requires:
  - phase: 01-记忆基础设施/01-01
    provides: "MemoryConfig.generateTextMaxRetries 字段已埋（仅 type 层，本 plan 补齐 config 链）"
provides:
  - "StepRecord 接口 + recordStep / getLLMStats / resetLLMStats（onStepFinish 驱动的按步累加，替换 startLLMCall/endLLMCall）"
  - "LLMStats.totalTokens 字段（成本可观测）"
  - "runAgentLoop 改造：废除强制 speak 兜底 + onStepFinish 按步计数 + generateText 失败重试"
  - "AgentConfig.generateTextMaxRetries 完整 config 链（types.ts + config.ts + agent-config.json）"
  - "STAT 日志块含 llmTotalTokens"
affects: [phase-5-push-gating, phase-6-observability, phase-4-reflection]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AI SDK v6 onStepFinish 回调按步累加统计（一个 step = 一次 LLM 调用）"
    - "回调内 try/catch 双重自愈（Pitfall 1：SDK 静默吞回调内抛错）"
    - "Date.now() 差值作 durationMs（StepResult 无 performance.totalMs 字段）"
    - "generateText 失败重试循环（for 循环 + attempt 计数 + ERROR 日志 + endReason=error）"
    - "config 键自包含（W1 fix：types.ts + config.ts + agent-config.json 三处一致，无跨 wave 依赖）"

key-files:
  created:
    - "src/llm/stats.test.ts"
  modified:
    - "src/llm/stats.ts"
    - "src/agent/react.ts"
    - "src/agent/react.test.ts"
    - "src/types.ts"
    - "src/config.ts"
    - "data/agent-config.json"

key-decisions:
  - "AI SDK v6 真实 API 为 onStepFinish（非 RESEARCH 文档的 onStepEnd）：按 Rule 1 修正为真实 API，usage 字段用 inputTokens/outputTokens（非 promptTokens/completionTokens）"
  - "StepResult 无 performance.totalMs 字段（A1 验证结论）：durationMs 始终用 Date.now() 差值，不依赖 provider 上报"
  - "失败路径 calls 可能 === 0（Pitfall 2）：generateText 在第一步前 reject 时 onStepFinish 不触发，这是 onStepFinish 相对 result.steps.length 的已知权衡，STAT 日志的 attempts 数可见"
  - "generateTextMaxRetries 默认 1（D-10）：总 attempts = 2，无指数退避（RESEARCH Open Question 2）"
  - "W1 自包含：config.generateTextMaxRetries 键由本 plan 完整写入 types.ts/config.ts/agent-config.json，不依赖 01-02（consolidation 段仍属 01-02）"

patterns-established:
  - "Pattern: onStepFinish 按步统计（替换整次 generateText 包装）"
  - "Pattern: 回调内双层自愈（recordStep 内部 no-throw + 外层 onStepFinish try/catch）"
  - "Pattern: generateText 重试循环（读 config.generateTextMaxRetries）"
  - "Pattern: config 键自包含三件套（types Pick + defaultBehavior + json 键）"

requirements-completed: [MEM-03, MEM-04]

# Metrics
duration: 9min
completed: 2026-06-20
status: complete
---

# Phase 1 Plan 03: ReAct loop 废 speak + onStepFinish 按步计数 + generateText 重试 Summary

**废除空游荡强制 speak 兜底（MEM-03），用 AI SDK v6 onStepFinish 回调替换整次 generateText 包装让 LLM 统计反映真实步数（MEM-04/D-11），加 generateText 失败重试（D-10）与 config.generateTextMaxRetries 键自包含（W1 fix）。**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-06-20T13:04:52Z
- **Completed:** 2026-06-20T13:14:17Z
- **Tasks:** 2
- **Files modified:** 7（新建 1 / 修改 6）

## Accomplishments

- **MEM-03**：删除 `react.ts:222-229` 空游荡强制 speak nonsense 兜底推送整块，移除未使用的 `speak` import；空游荡 `spokeTimes===0` 不再推送，STAT 块 `speakCount` 已体现（D-07）
- **MEM-04/D-11**：`generateText` 加 `onStepFinish` 回调按步累加 `recordStep`，替换旧版 `startLLMCall/endLLMCall` 整次包装（旧版 calls 恒 1，多步 loop 严重失真）；多步 loop 后 `getLLMStats().calls > 1`
- **D-10**：generateText 失败重试循环，读 `config.generateTextMaxRetries`（默认 1，总 attempts = 2），每次 attempt catch 记 ERROR 日志，最后一次失败 `ctx.endReason = 'error'`；无指数退避
- **Pitfall 1 自愈**：`recordStep` 内部 no-throw（收到 null/缺字段容错）+ `onStepFinish` 外层 try/catch 双重兜底（SDK 静默吞回调内抛错，双保险确保不阻断主流程）
- **A1 验证结论**：AI SDK v6（`ai@6.0.168`）的 `StepResult` **无** `performance.totalMs` 字段，`durationMs` 始终用 `Date.now()` 差值（provider 不上报耗时是既定事实，差值是唯一可靠来源）
- **W1 fix**：`generateTextMaxRetries` config 键由本 plan 自包含写入三处（`types.ts` AgentConfig 字段 + `config.ts` BehaviorConfig Pick 列表 + defaultBehavior 默认值 + `data/agent-config.json` 键），无跨 wave 依赖，无临时硬编码，无 TODO
- STAT 日志块新增 `llmTotalTokens`（成本可观测）
- 测试：新建 `stats.test.ts` 5 条（累加/聚合/reset/no-throw/空状态）+ 扩展 `react.test.ts` 至 6 条（config 自包含/按步计数 calls>1/durationMs>0/空游荡不推送/失败重试/Pitfall 1 自愈），全绿

## Task Commits

每个 task 原子提交（中文 Conventional Commits）：

1. **Task 1: stats.ts 重构为 onStepFinish 驱动的按步累加 + Wave 0 测试** - `69a5a80` (feat)
2. **Task 2: react.ts 删强制 speak + onStepFinish 按步计数 + generateText 重试 + config 键自包含 + 扩展测试** - `d6acf8b` (feat)

## Files Created/Modified

- `src/llm/stats.ts`（修改，~80 行）— `StepRecord` 接口 + `recordStep`（no-throw 纯内存累加）+ `getLLMStats`（聚合 calls/totalMs/avgMs/totalTokens）+ `resetLLMStats`；删除 `startLLMCall`/`endLLMCall`/`CallRecord`/`currentCall` 旧 API
- `src/llm/stats.test.ts`（新建，~70 行）— Wave 0 单测覆盖 5 条断言（recordStep 累加/聚合/reset/no-throw 自愈/空状态）
- `src/agent/react.ts`（修改）— import 改 `recordStep`（移除 `startLLMCall`/`endLLMCall`）；generateText 块改造为 D-10 重试循环 + `onStepFinish` 回调（双层 try/catch + Date.now() 差值 durationMs）；STAT 块加 `llmTotalTokens`；删除 `react.ts:222-229` 强制 speak 块 + 移除未用 `speak` import
- `src/agent/react.test.ts`（修改，~135 行）— 6 条新测试，复用 `useTempDataDir`/`_resetReactModuleState`/`ToolManager.reset`，加 `mock.module('ai')` 注入假 generateText 模拟多步 onStepFinish 调用
- `src/types.ts`（修改）— `AgentConfig` 加 `generateTextMaxRetries: number` 字段（W1）
- `src/config.ts`（修改）— `BehaviorConfig` Pick 列表加 `'generateTextMaxRetries'`；`defaultBehavior` 加 `generateTextMaxRetries: 1`（D-10 默认）
- `data/agent-config.json`（修改）— 追加 `generateTextMaxRetries: 1` 键 + 注释（不动 consolidation 段）

## Decisions Made

- **AI SDK v6 真实 API 偏差修正（Rule 1）**：RESEARCH.md 与 PLAN.md 基于 `ai@6.0.208` 假设的 `onStepEnd({ stepNumber, usage, performance })` 签名。实际安装版是 `ai@6.0.168`（计划文未更新版本），真实 API 是 `onStepFinish(StepResult)`，`StepResult.usage` 字段为 `inputTokens/outputTokens/totalTokens`（不是 `promptTokens/completionTokens`），且 **StepResult 没有 `performance.totalMs` 字段**。按 Rule 1（修正 SDK API 不匹配的 bug）改为真实 API；`durationMs` 始终用 `Date.now()` 差值（A1 验证结论：provider 不上报 performance 是既定事实）。
- **失败路径 calls 可能 === 0 的接受（Pitfall 2 权衡）**：旧版 `startLLMCall/finally endLLMCall` 能在 generateText reject 时也计 1 次；新版 `onStepFinish` 仅在至少一步完成时触发，第一步前 reject 时 calls === 0。这是 onStepFinish 相对 `result.steps.length` 的已知权衡（RESEARCH Pitfall 2 明确提及）。接受：失败路径已有 ERROR 日志（含 attempt 次数）+ `endReason='error'`，成本观测需求由成功路径的按步计数满足。
- **测试用 mock.module('ai') 注入假 generateText**：真实 LLM 多步工具 loop 难以在单测中确定性触发。用 `mock.module('ai')` 让 generateText 直接多次调 `onStepFinish`，可控验证 calls>1 / durationMs>0 / 空游荡不推送。这是 RESEARCH.md 建议的"后者更可控"路径。
- **A1 durationMs 测试加 5ms setTimeout**：mock 的 generateText 同步执行时 `Date.now() - attemptStart` 可能为 0。加 5ms 延迟模拟真实 LLM 调用耗时，确保差值 > 0（真实 LLM 调用每步几十~几百毫秒，测试反映真实场景）。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] AI SDK v6 真实 API 偏差：onStepEnd → onStepFinish，字段名修正**
- **Found during:** Task 2（实现前先 Context7 + 代码核查 ai@6.0.168 真实 API）
- **Issue:** PLAN/RESEARCH 基于 `ai@6.0.208` 假设 `onStepEnd({ stepNumber, usage, performance })` 签名。实际安装 `ai@6.0.168`：回调名是 `onStepFinish`；usage 字段是 `inputTokens/outputTokens/totalTokens`（非 `promptTokens/completionTokens`）；**StepResult 无 `performance.totalMs` 字段**。
- **Fix:** 按真实 API 实现：`onStepFinish({ stepNumber, usage })`；`promptTokens: usage?.inputTokens` / `completionTokens: usage?.outputTokens`；`durationMs: Date.now() - attemptStart`（始终用差值，不依赖 performance）。
- **Files modified:** src/agent/react.ts
- **Verification:** `bun run typecheck` 通过（真实 API 签名匹配）；`bun test src/agent/react.test.ts` 6 条全绿
- **Committed in:** d6acf8b（Task 2）

**2. [Rule 1 - Bug] 移除 react.ts 未使用的 speak import**
- **Found during:** Task 2（删强制 speak 块后 grep 确认）
- **Issue:** 删除 `react.ts:222-229` 强制 speak 块后，`speak` import 不再被调用，违反 CLAUDE.md「Push 前检查 diff，确认无调试代码遗留」+ tsc 严格模式
- **Fix:** 移除 `import { speak } from '../tools/push/speak.js'`
- **Files modified:** src/agent/react.ts
- **Verification:** `bun run typecheck` 通过（无 unused import 警告）
- **Committed in:** d6acf8b（Task 2）

**3. [Rule 1 - Bug] 既有 react.test.ts 失败路径断言与新设计冲突**
- **Found during:** Task 2（实现后跑既有 react.test.ts）
- **Issue:** 既有测试断言 `getLLMStats().calls >= 1` 在失败路径（mockFetchError）下成立（旧版 start/end 包装）。新版 onStepFinish 在 generateText 整体 reject 时（第一步前）不触发，calls === 0（Pitfall 2 已知权衡），断言失败。
- **Fix:** 重写 react.test.ts：既有"失败计 calls>=1"断言不适用于新设计；改为断言新契约 `endReason==='error'` + `consecutiveFailures+1`（D-10 行为）；按 PLAN 的 6 条新断言落地（含 calls>1 成功路径、空游荡不推送、Pitfall 1 自愈）。
- **Files modified:** src/agent/react.test.ts
- **Verification:** `bun test src/agent/react.test.ts` 6 条全绿
- **Committed in:** d6acf8b（Task 2）

**4. [Rule 1 - Bug] stats.ts 文件头注释提及已删除的符号名（source-grounding）**
- **Found during:** Task 1 验收（`grep -c 'startLLMCall|endLLMCall'` 期望 0，实测 1）
- **Issue:** 文件头 docstring 用 `取代旧版 startLLMCall/endLLMCall 包装` 描述历史，但验收标准要求 grep count === 0（source-grounding 排除已删除符号）
- **Fix:** 改写为不提及具体符号名：`取代旧版"把整次 generateText 包装成一次"的统计方式`
- **Files modified:** src/llm/stats.ts
- **Verification:** `grep -c 'startLLMCall|endLLMCall' src/llm/stats.ts` === 0
- **Committed in:** 69a5a80（Task 1）

---

**Total deviations:** 4 auto-fixed（全部 Rule 1 bug，其中 1 个 SDK API 不匹配是最大修正）
**Impact on plan:** 所有修正都是为了与新设计/API 一致的必要调整，无 scope creep。PLAN 的核心目标（废 speak + 按步计数 + 重试 + config 自包含）全部达成。

## Issues Encountered

- **AI SDK 版本偏差**：RESEARCH.md 标注 `ai@6.0.208`，实际安装 `ai@6.0.168`。版本差异导致回调 API 不同（onStepEnd → onStepFinish）。通过代码核查 `node_modules/ai/dist/index.d.ts` 确认真实签名，按真实 API 实现并记录为 Rule 1 偏差。建议后续 phase 的 RESEARCH 在 planning 期用 Context7 复核安装版本而非最新版。
- **Pitfall 2 失败路径计数**：onStepFinish 在 generateText 整体 reject 时拿不到回调（与 result.steps.length 同问题）。接受此权衡（失败路径靠 ERROR 日志 + endReason 显式化），不回退到旧 start/end 包装。

## User Setup Required

None — 无外部服务配置。`generateTextMaxRetries` 默认值 1 已在 `data/agent-config.json` 写入，用户可在该文件调整重试次数（D-10）。

## Next Phase Readiness

- **01-02（consolidator 接线）无冲突**：本 plan 仅追加 `generateTextMaxRetries` 键到 `data/agent-config.json`，未动 `consolidation` 段；`MemoryConfig.generateTextMaxRetries` 字段由 01-01 已埋（type 层），本 plan 补齐根 `AgentConfig` config 链
- **Phase 5（推送门控）就绪**：MEM-03 废除强制 speak 是推送门控的前提（门控决定推 or 只学，强制 speak 与之矛盾）
- **Phase 6（可观测性）就绪**：STAT 日志含 `llmCalls`（真实步数）/ `llmTotalMs` / `llmTotalTokens`，为成本/性能可视化提供数据

## TDD Gate Compliance

本 plan 两个 task 均标 `tdd="true"`。验证序列：
- **Task 1**：先写 `stats.test.ts`（RED：`Export named 'recordStep' not found`）→ 重构 `stats.ts`（GREEN：5 pass）→ 同 commit 提交（`69a5a80` feat）。测试与实现共同落地。
- **Task 2**：先实现 react.ts/config 三件套（无独立 test commit）→ 写扩展测试 → 同 commit 提交（`d6acf8b` feat）。既有 react.test.ts 因新设计回归（失败路径 calls 断言不适用）已重写为新契约。

Gate 序列：feat(...) commits 存在，每个含实现 + 测试。REFACTOR 未触发（实现已满足 Anti-Nesting ≤2 层 / 方法 ≤40 行 / 无魔法值 / 无 silent catch 等约束）。

## Self-Check: PASSED

**Files exist:**
- FOUND: src/llm/stats.ts
- FOUND: src/llm/stats.test.ts
- FOUND: src/agent/react.ts
- FOUND: src/agent/react.test.ts
- FOUND: src/types.ts
- FOUND: src/config.ts
- FOUND: data/agent-config.json
- FOUND: .planning/phases/01-记忆基础设施/01-03-SUMMARY.md

**Commits exist:**
- FOUND: 69a5a80 (feat(01-03): 重构 stats.ts 为 onStepFinish 驱动的按步累加)
- FOUND: d6acf8b (feat(01-03): react.ts 废强制 speak + onStepFinish 按步计数 + generateText 重试)

**Test verification:**
- bun test（全量）→ 80 pass / 0 fail（baseline 70 + 5 stats + 5 react 净增）
- bun run typecheck → 通过（strict mode）

---
*Phase: 01-记忆基础设施*
*Plan: 01-03*
*Completed: 2026-06-20*
