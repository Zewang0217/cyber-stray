---
phase: 1
slug: memory-infrastructure
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-20
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

> Planner 填充。权威映射来自 `01-RESEARCH.md` § Validation Architecture。

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | MEM-01 | — | （planner 填） | unit | `bun test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> RESEARCH.md 标注的 Wave 0 缺口（如 onStepEnd 的 totalMs 在 DeepSeek provider 下是否填充）。Planner/executor 落具体 stub 文件。

- [ ] onStepEnd 回调内 try/catch 自愈的单测（防 SDK 静默吞错 — D-11 关键陷阱）
- [ ] JSON sidecar 原子双写崩溃一致性的单测（temp-file + rename）

*其余既有基础设施覆盖；具体清单 planner 据 RESEARCH.md § Validation Architecture 落地。*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| （planner 填） | — | — | — |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
