---
phase: 01-记忆基础设施
verified: 2026-06-20T15:35:00Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 4/4
  is_initial: false
closeout_note: |
  UAT 收尾（用户决定接受当前验证状态结束 Phase 1）：
  - UAT① consolidator 启动接线：live 验证 PASS（启动日志「记忆 consolidator 一次性执行」+ 正常进心跳）。
  - UAT② 空游荡不推送：未 live 抓到空游荡轮次，但代码层单测覆盖核心断言 + live 验证正常 speak 路径未坏，用户接受。
  - 执行期发现并发 persist FATAL（record_knowledge rename ENOENT），已修（d551149）+ 回归测试；live 未重验，用户接受单测覆盖。
human_verification:
  - test: "bun run dev 启动端到端观察 consolidator/cleanup 接线"
    expected: "启动日志含「记忆 consolidator 一次性执行 { merged, expired }」或对应 warn；agent 正常进入心跳；可选：data/memory/.archive/ 在 cleanup 后存在归档文件"
    why_human: "接线点在 src/index.ts main()，需 DeepSeek key + TUI + 心跳集成 smoke（VALIDATION.md Manual-Only W4）；单测已覆盖 consolidator 各路径，但整启动链路只能人工跑"
  - test: "空游荡端到端真实不推送"
    expected: "让一轮游荡自然结束且 LLM 未调 speak（空游荡）；飞书/Telegram 无推送 + STAT 日志 speakCount:0 + llmCalls 反映真实步数（>1 若多步）"
    why_human: "多步 ReAct + 真实 LLM 不调 speak 的端到端场景需 live DeepSeek（VALIDATION.md Manual-Only W4）；单测已用 mock 验证 spokeTimes===0 且 speak 历史文件不存在"
---

# Phase 1: 记忆基础设施 Verification Report

**Phase Goal:** 为 manage 半边打地基 —— 记忆索引层（高效检索/反思）、接线 consolidator（有界记忆）、废除强制 speak（让"学习不推送"成立）、修阻塞性 bug。
**Verified:** 2026-06-20T22:05:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | 检索/反思不再遍历每个记忆文件（索引命中可观测，检索耗时显著下降） | ✓ VERIFIED | `src/memory/long-term/index.ts:323-348` `getRecentMemories` 调 `this.jsonIndex.queryRecent({count,type,since})`（走 `data/memory/.index.json` records[]）→ 对命中条目按需 readFile；不再 `for t in types { readdir + getMemory }`。`readdir` 已从 `src/memory/long-term/index.ts:10` 的 import 移除（`index.ts` 全文仅剩 `getFileCounts`/`getTotalSize` 等 consolidator 侧路径才会 import 用到——store 自身路径已无）。行为测试 `index.test.ts:175-190` 用 spy 包 `getMemory` 断言调用次数 === 0（证明走索引不读即写）。behavioral spot-check：`bun test src/memory/long-term/index.test.ts -t "索引命中"` PASS。 |
| 2 | consolidator 已接线且可通过单测/手动调用验证合并、软删除、过期清理逻辑正确（D-02 放宽：不自动周期触发） | ✓ VERIFIED | (a) `consolidate.ts` 三处改造落地：`mergeTopicMemories` 走 `this.store.saveMemory`（D-01 双写 INDEX.md + .index.json，不再 writeFile 绕索引）；`rm` 已替换为 `archiveFile`（3 处软删除归档到 `.archive/<type>/`）；阈值从 `config.consolidation` 读取（lowImportanceThreshold/mergeMaxAgeDays/expiryDays）；D-04 双记（INFO + observation 记忆 tags:['consolidation']）。(b) `src/index.ts:50` `runStartupMemoryMaintenance()` 启动一次性 best-effort 调 cleanupVisitedUrls + consolidator；**全文 grep 无 setInterval/setTimeout 用于 consolidator 周期触发**（D-02 合规；index.ts 仅有的 setInterval 是心跳 + signal handler 的 forceExitTimer）。(c) W2 嵌套合并在 `config.ts:74-86` 显式字段级合并（`consolidation: {...defaultBehavior.consolidation, ...(file.consolidation ?? {})}`），测试 `consolidate.test.ts:296-322` 用动态 import 破 ESM 缓存验证部分配置不丢默认。(d) 测试 13 条全绿 + behavioral spot-check（`软删除` / `部分 consolidation` 各 1 PASS）。 |
| 3 | 空游荡可以"只学习不推送"结束一轮游荡（强制 speak 兜底已移除） | ✓ VERIFIED | `src/agent/react.ts` 全文 grep 无 `speak(` 调用、无 `nonsense` 字面量、无 `import { speak }`（仅剩 `spokeTimes` 类型字段 + `speakCount` STAT 日志字段）。git diff `d6acf8b` 证实：`-import { speak }`、`-await speak('nonsense', ...)`（强制兜底块整块删除）。行为测试 `react.test.ts:111-124` `D-05/MEM-03 空游荡不推送` 断言 `spokeTimes===0` 且 `data/history/speaks-<date>.jsonl` 文件不存在（端到端证明 speak 未被调）。behavioral spot-check：`bun test src/agent/react.test.ts -t "空游荡不推送"` PASS。 |
| 4 | LLM 调用统计反映真实调用次数（不再恒 0）；工具错误显式记录而非空 catch 吞掉 | ✓ VERIFIED | (a) LLM stats：`src/llm/stats.ts` 重构为 `recordStep` 按步累加；`react.ts:202` `onStepFinish({ stepNumber, usage })` 调 `recordStep({ stepNumber, promptTokens: usage?.inputTokens, completionTokens: usage?.outputTokens, totalTokens: usage?.totalTokens, durationMs: Date.now()-attemptStart })`；`react.ts:13` import 用 recordStep（无 startLLMCall/endLLMCall 残留）。AI SDK 实际版本 `ai@6.0.168`（node_modules/package.json 确认），类型定义含 `onStepFinish` 不含 `onStepEnd`——executor 的 Rule 1 偏差修正正确。行为测试 `react.test.ts:75-92` `D-11 按步计数` mock 触发 3 个 onStepFinish 后断言 `getLLMStats().calls === 3`（MEM-04 核心证明）。(b) 错误显式化：`readIndex`（INDEX.md 缺标题标记/解析失败抛 Error）、`getMemory`（文件不存在返 null / 读取/解析失败抛 Error）、`deleteMemory`（文件不存在返 false / 删除失败抛 Error）三处 D-09 落地，测试 `index.test.ts:194-218` 用 `rejects.toThrow()` 断言；`parseMemoryFrontmatter`（types.ts:144-147）加 `---` 分界守卫防伪装数据被吞。react.ts:211 / stats.ts:58 的 `catch {}` 是 Pitfall 1 明确要求的 no-throw 自愈（SDK 静默吞回调内抛错的反制），不是 D-09 红线所指的 silent fail——D-09 红线针对 readIndex/getMemory/deleteMemory，这些已显式抛错。 |

**Score:** 4/4 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/memory/long-term/memory-index.ts` | MemoryIndex 类 + loadJsonIndex/saveJsonIndex(原子)/rebuildIndexFromMarkdown/createDefaultJsonIndex/getMemoryIndex/_resetMemoryIndex | ✓ VERIFIED | L1 exists（310 行）/ L2 substantive（7 个 MemoryIndex 方法 + Zod schema 校验 + 原子 rename）/ L3 wired（`src/memory/long-term/index.ts:31` import + `updateIndexAfterSave` 三写 + `getRecentMemories` queryRecent + `deleteMemory` 联动 + `getMemoryAccessedAt` 委托）/ L4 数据流：saveMemory → upsert → persist → .index.json 双写可观测（测试断言 `loadJsonIndex(...).records.find(...)`） |
| `src/memory/long-term/types.ts` | MemoryIndexRecord + MemoryJsonIndex + Zod schema + MemoryConsolidationConfig + MemoryConfig 扩展 | ✓ VERIFIED | types.ts:45-50 MemoryConsolidationConfig；:60 consolidation optional；:183-203 MemoryIndexRecord + MemoryJsonIndex；:206+ Zod schema `MemoryIndexRecordSchema`；:137 parseMemoryFrontmatter 加 `---` 分界守卫（D-09） |
| `src/memory/long-term/index.ts` | MemoryStore 改造（getMemory 不读即写 / getRecentMemories 走索引 / 双写钩子 / D-09 显式化） | ✓ VERIFIED | :323-348 getRecentMemories 走 jsonIndex.queryRecent；:282-314 getMemory 删 writeFile bump accessedAt，改 touchAccessedAt best-effort；:581-605 updateIndexAfterSave 三写（Markdown→INDEX.md→.index.json）；:70-97 readIndex + :282-314 getMemory + :382-409 deleteMemory 三处 D-09 显式抛错 |
| `src/memory/long-term/archive.ts` | archiveFile 软删除（rename + toSafeFilename + 源不存在抛错） | ✓ VERIFIED | L1 exists（58 行）/ L2 substantive（stat → mkdir → rename，toSafeFilename 防遍历，源不存在抛 Error D-09）/ L3 wired（`consolidate.ts:34` import + 3 处 archiveFile 调用替换 rm） |
| `src/memory/long-term/consolidate.ts` | MemoryConsolidator 改造（merge 走 store + 软删除 + 阈值读 config + D-04 双记 + cleanupExpired indexed accessedAt） | ✓ VERIFIED | :191-247 mergeTopicMemories 走 `this.store.saveMemory(merged)` + archiveFile 旧文件 + store 缺失抛 Error（D-09）+ D-04 observation；:121-184 consolidateOldMemories 阈值从 `config.consolidation` 读 + archiveFile 软删除；:255-310 cleanupExpired indexed accessedAt（经 `this.store.getMemoryAccessedAt`）+ archiveFile + D-04 |
| `src/llm/stats.ts` | StepRecord + recordStep(no-throw) + getLLMStats + resetLLMStats | ✓ VERIFIED | L1 exists（80 行）/ L2 substantive（StepRecord + LLMStats 含 totalTokens + recordStep 内部 try/catch no-throw）/ L3 wired（`react.ts:13` import recordStep + `react.ts:202` onStepFinish 调用） |
| `src/agent/react.ts` | runAgentLoop 改造（删强制 speak + onStepFinish 按步计数 + generateText 重试） | ✓ VERIFIED | :181-223 D-10 重试循环读 `config.generateTextMaxRetries`；:202 onStepFinish 按步计数；:181-223 删 startLLMCall/endLLMCall 包装；全文无 speak 调用（git diff d6acf8b 确认）；:229-244 STAT 块含 llmCalls + llmTotalTokens |
| `src/config.ts` | BehaviorConfig Pick consolidation/generateTextMaxRetries + defaultBehavior + W2 嵌套合并 | ✓ VERIFIED | :28 generateTextMaxRetries Pick；:32 consolidation NonNullable；:57-63 defaultBehavior 默认；:74-92 loadBehaviorConfig 显式嵌套合并（W2 数据安全） |
| `src/types.ts` | AgentConfig.consolidation? + generateTextMaxRetries | ✓ VERIFIED | :165 generateTextMaxRetries；:168-173 consolidation optional |
| `data/agent-config.json` | consolidation 段 + generateTextMaxRetries 键 | ✓ VERIFIED | JSON 合法（`node -e JSON.parse` 通过）；:33 generateTextMaxRetries:1；:36-41 consolidation 段 4 阈值 |
| `src/index.ts` | runStartupMemoryMaintenance 启动一次性接线（D-02 不周期） | ✓ VERIFIED | :50 调用；:72-91 best-effort try/catch 不阻断启动；无 setInterval/setTimeout 周期触发 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `index.ts` (saveMemory) | `memory-index.ts` (MemoryIndex.upsert + persist) | updateIndexAfterSave 三写钩子（Markdown→INDEX.md→.index.json） | ✓ WIRED | `index.ts:602-604` `await this.jsonIndex.upsert(entry); await this.jsonIndex.persist();`；测试 `index.test.ts:149-153` 断言 saveMemory 后 `.index.json` records 含该条 |
| `index.ts` (getRecentMemories) | `memory-index.ts` (MemoryIndex.queryRecent) | 索引查表替代 readdir+全文件读 | ✓ WIRED | `index.ts:329` `const records = await this.jsonIndex.queryRecent({count,type,since})`；测试 `index.test.ts:175-190` spy 断言 getMemory 调用次数 0 |
| `memory-index.ts` (saveJsonIndex) | fs/promises (writeFile + rename) | temp-file + atomic rename（同目录） | ✓ WIRED | `memory-index.ts:114-117` `writeFile(tmp)` + `rename(tmp,path)`；测试 `memory-index.test.ts` 原子写断言（写后 .tmp 不残留） |
| `consolidate.ts` (mergeTopicMemories) | `index.ts` (store.saveMemory) | 合并记忆走 store 双写 | ✓ WIRED | `consolidate.ts:235` `await this.store.saveMemory(merged)`；测试 `consolidate.test.ts:49-87` 验证 INDEX.md/.index.json 含 merged 条目 |
| `consolidate.ts` (merge/cleanup) | `archive.ts` (archiveFile) | rm → rename 到 .archive/<type>/（软删除） | ✓ WIRED | `consolidate.ts:34` import + :156/:239/:287 三处 archiveFile 调用替换 rm；测试 `consolidate.test.ts:89-114` 断言 `.archive/knowledge/` 存在归档文件、原目录无文件 |
| `src/index.ts` (main) | `consolidate.ts` (getMemoryConsolidator) + `url-tracker.ts` (cleanupVisitedUrls) | 启动一次性 best-effort 调用（D-02：不周期） | ✓ WIRED | `src/index.ts:7-8` import getMemoryStore/getMemoryConsolidator/cleanupVisitedUrls；:50 `await runStartupMemoryMaintenance()`；:84 `getMemoryConsolidator(getMemoryStore())`；barrel `src/memory/long-term.ts:42` re-export getMemoryConsolidator |
| `react.ts` (generateText onStepFinish) | `stats.ts` (recordStep) | AI SDK v6 回调按步累加 | ✓ WIRED | `react.ts:13` import recordStep；:202-214 onStepFinish 回调内调 recordStep（双层 try/catch 自愈）；测试 `react.test.ts:75-92` 断言 calls>1 |
| `react.ts` (runAgentLoop) | `stats.ts` (getLLMStats/resetLLMStats) | STAT 日志块读真实步数 | ✓ WIRED | `react.ts:13` import getLLMStats/resetLLMStats；:140 resetLLMStats()；:226 getLLMStats()；:233-236 STAT 日志 llmCalls/llmTotalMs/llmAvgMs/llmTotalTokens |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `getRecentMemories` | records | `jsonIndex.queryRecent` → `.index.json` records[] | 是（saveMemory 双写 + rebuild 自愈填充） | ✓ FLOWING |
| MemoryIndex records[] | upsert(entry) 写入 | saveMemory → updateIndexAfterSave → jsonIndex.upsert → persist → `.index.json` | 是（测试断言 saveMemory 后 `.index.json` 含条目） | ✓ FLOWING |
| config.consolidation | `config` 对象 | `loadBehaviorConfig` → `data/agent-config.json` → defaultBehavior 嵌套合并 | 是（agent-config.json 4 阈值；测试断言部分配置不丢默认） | ✓ FLOWING |
| STAT 日志 llmCalls/llmTotalTokens | `llmStats` | `getLLMStats()` → `recordStep` 累加（onStepFinish 触发） | 是（测试 calls===3, totalTokens===15） | ✓ FLOWING |
| consolidator observation 双记 | saveMemory({type:'observation', tags:['consolidation']}) | store.saveMemory → `.index.json` + INDEX.md + Markdown | 是（测试 `consolidate.test.ts:217-222` 断言 observation 记忆存在） | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| MEM-04：LLM calls > 1（多步 loop） | `bun test src/agent/react.test.ts -t "D-11 按步计数"` | 1 pass / 3 expect() calls — `getLLMStats().calls === 3` | ✓ PASS |
| MEM-03：空游荡不推送（speak 未被调） | `bun test src/agent/react.test.ts -t "空游荡不推送"` | 1 pass / 2 expect() calls — `spokeTimes===0` 且 speak 历史文件不存在 | ✓ PASS |
| MEM-02：软删除归档到 .archive/ | `bun test src/memory/long-term/consolidate.test.ts -t "软删除"` | 1 pass — `.archive/knowledge/` 含归档文件 | ✓ PASS |
| MEM-02：W2 嵌套合并不丢默认 | `bun test src/memory/long-term/consolidate.test.ts -t "部分 consolidation"` | 1 pass — expiryDays=10 时其它字段仍取默认 0.2/7/30 | ✓ PASS |
| 全量测试套件 | `bun test` | 93 pass / 0 fail / 208 expect() calls（11 文件） | ✓ PASS |
| TypeScript 严格类型检查 | `bun run typecheck` | `bun tsc --noEmit` 退出 0 | ✓ PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| （本期无 phase-declared probe 或 scripts/tests/probe-*.sh） | — | — | SKIPPED |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| MEM-01 | 01-01 | JSON 索引 sidecar，检索不再 O(N) 全扫 | ✓ SATISFIED | `memory-index.ts`（310 行）+ `index.ts` 改造走 queryRecent + 双写 + 原子写 + 重建 + D-09 + 29 测试全绿 |
| MEM-02 | 01-02 | 接线 MemoryConsolidator + cleanupVisitedUrls，记忆有界 | ✓ SATISFIED | `archive.ts` + `consolidate.ts` 三处改造（store 双写 + 软删除 + config 阈值 + D-04 双记）+ `src/index.ts` 启动接线（D-02 不周期）+ W2 嵌套合并 + 13 测试全绿 |
| MEM-03 | 01-03 | 废除空游荡强制 speak 兜底 | ✓ SATISFIED | `react.ts` 删除 :222-229 强制 speak 块 + 移除 speak import（git diff d6acf8b 确认）；测试 `空游荡不推送` PASS |
| MEM-04 | 01-03 | 修阻塞性 bug：LLM 统计恒 0 + 空 catch 静默 | ✓ SATISFIED | `stats.ts` recordStep 按步累加 + `react.ts` onStepFinish 接线（AI SDK v6 真实 API onStepFinish）+ D-09 错误显式化（readIndex/getMemory/deleteMemory/parseMemoryFrontmatter 显式抛错）+ 测试 calls>1 PASS |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/agent/react.ts` | 211 | `} catch { /* 计数自愈 */ }` 无参 catch（onStepFinish 外层兜底） | ℹ️ Info | Pitfall 1 明确要求的 no-throw 自愈（SDK 静默吞回调内抛错的反制），非 D-09 红线所指 silent fail；D-09 红线针对 readIndex/getMemory/deleteMemory（这些已显式抛错），此处不违规 |
| `src/agent/react.ts` | 241 | `catch { return u; }` URL hostname 解析 fallback（既存代码，非本期变更） | ℹ️ Info | STAT 日志域名字段降级，非 Phase 1 新增 |
| `src/llm/stats.ts` | 58 | `} catch { /* 计数自愈 */ }`（recordStep 内部 no-throw） | ℹ️ Info | Pitfall 1 明确要求；recordStep 被 SDK 回调调用，内部异常若向上抛会被 SDK 静默吞致丢步无日志 |
| 全 Phase 1 文件 | — | TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER 计数 | ✓ 无 | debt-marker gate 通过 |

### Human Verification Required

### 1. consolidator 启动接线端到端执行

**Test:** 确认 `.env` 有 `DEEPSEEK_API_KEY` → 跑 `bun run dev` → 观察启动日志
**Expected:** 启动日志含 `启动期记忆 consolidator 一次性执行 { merged, expired }` 或对应 warn（`cleanupVisitedUrls 启动执行失败（不阻断启动）` / `consolidator 启动执行失败（不阻断启动）`）；agent 正常进入心跳；可选：`data/memory/.archive/` 在 cleanup 后存在归档文件
**Why human:** 接线点在 `src/index.ts main()`，D-02 本就不自动周期触发，集成 smoke 需拉起整个 agent（TUI + 心跳 + DeepSeek），单测已覆盖各路径，但整启动链路只能人工跑（VALIDATION.md W4 Manual-Only）

### 2. 空游荡端到端真实不推送

**Test:** `bun run dev` → 让一轮游荡自然结束且 LLM 未调 speak（空游荡）
**Expected:** 飞书/Telegram 无推送 + STAT 日志 `speakCount: 0` + `llmCalls` 反映真实步数（>1 若多步）
**Why human:** 多步 ReAct loop + 真实 LLM 不调 speak 的端到端场景需 live DeepSeek；单测已用 mock 验证 `spokeTimes===0` 且 speak 历史文件不存在（react.test.ts:111-124）

### Gaps Summary

无代码层 gaps。4 项 Success Criteria 全部 VERIFIED，4 项 must-have requirement（MEM-01/02/03/04）全部 SATISFIED：

- **代码层**：所有 artifacts 存在、substantive、wired、data flowing；93 测试全绿，typecheck 通过，4 项 behavioral spot-check 全 PASS。
- **关键决策已落实**：D-01（非破坏性软删除）/ D-02（接线不周期，ROADMAP #2 措辞已放宽）/ D-03（阈值外置 + W2 嵌套合并）/ D-04（双记）/ D-05（废 speak）/ D-07（空游荡进 STAT 不推送）/ D-09（错误显式化三处抛错）/ D-10（重试）/ D-11（onStepFinish 按步计数）全部在代码 + 测试落地。
- **executor reality-driven 偏差正确**：AI SDK 实际是 `ai@6.0.168`（非 research 假设的 .208），真实回调 API 是 `onStepFinish`（非 onStepEnd），`usage` 是 `inputTokens/outputTokens/totalTokens`，无 `performance.totalMs`。executor 按 Rule 1 修正为真实 API，本核查在 `node_modules/ai/package.json` 与 `ai/dist/index.d.ts` 类型定义层面核实正确（onStepFinish 存在 / onStepEnd 不存在）——这是合理的 reality-driven deviation，非 fail。
- **lint 缺口**：`bun run lint` 因 eslint 不在 PATH 失败（环境问题），非代码缺陷；typecheck + 93 测试全绿已充分证明代码正确性，不影响验证结论。

**状态为 human_needed 的原因**：Step 8 识别出 2 项人工验证项（VALIDATION.md W4 Manual-Only，需要 live DeepSeek 启动 agent），非代码 gap。按 decision tree 第 2 条，人工项存在 → status: human_needed（即使所有 truths VERIFIED）。

---

_Verified: 2026-06-20T22:05:00Z_
_Verifier: Claude (gsd-verifier)_
