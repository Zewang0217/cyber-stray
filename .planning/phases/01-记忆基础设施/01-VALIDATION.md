---
phase: 1
slug: memory-infrastructure
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-20
planned: 2026-06-20
plans: [01-01, 01-02, 01-03]
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> 权威测试映射见 `01-RESEARCH.md` § Validation Architecture（14 条测试映射，含 Wave 0 缺口）。本文件由 planner/executor 在规划与执行期填充 per-task 表。

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun test（Bun 内置 test runner，项目既有） |
| **Config file** | none — bun test 无需配置文件 |
| **Quick run command** | `bun test` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~5–15 秒 |

---

## Sampling Rate

- **After every task commit:** Run `bun test`
- **After every plan wave:** Run `bun test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 秒

---

## Per-Task Verification Map

> Planner 填充。权威映射来自 `01-RESEARCH.md` § Validation Architecture（14 条测试映射）。

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-T1 | 01-01 | 1 | MEM-01 | T-01-01/02/03 | .index.json 双写+原子写+重建+schema 漂移自愈 | unit | `bun test src/memory/long-term/memory-index.test.ts` | ❌ W0 新建 | ⬜ pending |
| 01-01-T2 | 01-01 | 1 | MEM-01 | T-01-04 | getMemory 不读即写 / getRecentMemories 走索引 / readIndex catch 显式化（D-09） | unit | `bun test src/memory/long-term/index.test.ts -t "索引命中\|读不重写\|错误显式化"` | ✅ 扩展 | ⬜ pending |
| 01-02-T1 | 01-02 | 2 | MEM-02 | T-01-06/07/09/11 | merge 走 store / 软删除 .archive/ / 阈值 config / D-04 双记 / store 缺失抛错 | unit | `bun test src/memory/long-term/consolidate.test.ts` | ❌ W0 新建 | ⬜ pending |
| 01-02-T2 | 01-02 | 2 | MEM-02 | T-01-08/10 | config 阈值 Zod 校验 / 启动接线 best-effort 不阻断 / **loadBehaviorConfig 嵌套合并不丢默认（W2）** | unit+启动 | `bun run typecheck` + `bun test src/memory/long-term/consolidate.test.ts -t "嵌套合并"` + 启动日志（见 Manual-Only） | ✅ config 既有 | ⬜ pending |
| 01-03-T1 | 01-03 | 1 | MEM-04 | T-01-12 | recordStep 累加 / no-throw 自愈（Pitfall 1）/ 聚合 / reset | unit | `bun test src/llm/stats.test.ts` | ❌ W0 新建 | ⬜ pending |
| 01-03-T2a | 01-03 | 1 | MEM-03 | T-01-16 | 空游荡不调 speak（D-05 废除兜底） | unit | `bun test src/agent/react.test.ts -t "空游荡不推送"` | ✅ 扩展 | ⬜ pending |
| 01-03-T2b | 01-03 | 1 | MEM-04 | T-01-12/13/14/15 | onStepEnd 按步计数 calls>1（D-11）/ generateText 失败重试（D-10）/ 回调自愈 / D-08 工具失败回喂路径确认 | unit | `bun test src/agent/react.test.ts -t "按步计数\|失败计数\|失败重试"` | ✅ 扩展 | ⬜ pending |

**Requirement coverage:** MEM-01 → 01-01 (T1+T2) · MEM-02 → 01-02 (T1+T2) · MEM-03 → 01-03 (T2a) · MEM-04 → 01-03 (T1+T2b) ✓

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> RESEARCH.md 标注的 Wave 0 缺口（5 个新建/扩展测试文件 + 2 个 A1/A5 provider 字段验证）。已分配到各 plan 的 Task 1。

- [x] `src/memory/long-term/memory-index.test.ts`（01-01 T1）— 双写/原子写/重建/索引命中/accessedAt 迁移/schema 漂移/解析失败抛错（7 条）
- [x] 扩展 `src/memory/long-term/index.test.ts`（01-01 T2）— getMemory 读不重写 / getRecentMemories 索引命中 / D-09 not found vs 抛错 / deleteMemory 索引联动（7 条）
- [x] `src/memory/long-term/consolidate.test.ts`（01-02 T1）— merge 走 store / 软删除 / 阈值 config / 过期 / D-04 双记 / store 缺失抛错 / .archive 不被重扫（7 条）
- [x] `src/llm/stats.test.ts`（01-03 T1）— recordStep 累加 / 聚合 / reset / no-throw 自愈 / 空状态（5 条）
- [x] 扩展 `src/agent/react.test.ts`（01-03 T2）— 按步计数 calls>1 / 空游荡不推送 / 失败重试 / onStepEnd 自愈 / durationMs>0（5 条）
- [x] onStepEnd 回调内 try/catch 自愈（防 SDK 静默吞错 — D-11 Pitfall 1）→ 01-03 T1/T2 覆盖
- [x] JSON sidecar 原子双写崩溃一致性（temp-file + rename）→ 01-01 T1 覆盖
- [ ] **A1 验证（executor 执行期）**：onStepEnd 的 `performance.totalMs` 在 DeepSeek provider 下是否填充 → 01-03 T2 测试断言 durationMs>0；若 provider 不填则 Date.now() 差值 fallback 生效
- [ ] **A5 验证（executor 执行期）**：`usage.{promptTokens,completionTokens,totalTokens}` DeepSeek provider 返回 → 01-03 T2 测试断言 totalTokens>0（若不返回则 getLLMStats totalTokens=0，不阻断）

*共享夹具复用 `src/test/helpers.ts`（useTempDataDir / mockChatCompletion / mockFetchError / restoreFetch / makeState）—— 无需新增夹具。*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 01-02 Task 2 启动接线（consolidator + cleanupVisitedUrls）端到端执行 | MEM-02 / D-02 | 接线点在 `src/index.ts main()`，D-02 本就**不自动周期触发**，集成 smoke test 需拉起整个 agent（TUI + 心跳 + DeepSeek），成本/噪音远高于本期收益；W4 fix 选择手动验证而非 smoke test | 1. 确认 `.env` 有 `DEEPSEEK_API_KEY`；2. 跑 `bun run dev`；3. 观察启动日志含 `记忆 consolidator 一次性执行 { merged, expired }` 或 `cleanupVisitedUrls 失败（不阻断启动）` / `consolidator 一次性执行失败（不阻断启动）` 的 warn；4. 确认 agent 正常进入心跳（接线失败不阻断启动，D-09 精神：错误可见不掩盖）；5. 可选：检查 `data/memory/.archive/` 在 cleanup 后存在归档文件（软删除可见） |
| 01-03 空游荡端到端不推送 | MEM-03 / D-05 | 多步 ReAct loop + LLM 真实不调 speak 的端到端场景，单测已 mock 验证核心断言，真实 LLM 行为作补充确认 | 1. `bun run dev`；2. 让一轮游荡自然结束且 LLM 未调 speak（空游荡）；3. 确认飞书/Telegram 无推送 + STAT 日志 `speakCount: 0` + `llmCalls` 反映真实步数（>1 若多步） |

*其余行为均有自动化验证（见 Per-Task Verification Map）。*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
