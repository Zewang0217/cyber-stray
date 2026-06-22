# Phase 1: 记忆基础设施 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-20
**Phase:** 1-记忆基础设施
**Areas discussed:** 遗忘策略, 空游荡行为, 工具错误处理（记忆索引形态未选，按默认决策）

---

## 遗忘策略

### Q1 遗忘语义（合并 vs 删除）

| Option | Description | Selected |
|--------|-------------|----------|
| 先合并后删除 | 同话题先 merge 进摘要，只对低价值+过期的才 rm | ✓（合并） |
| 直接删除 | 维持现行 rm，靠日志可观测 | |
| 软删除归档 | 移到 archive，N 天后才真删 | ✓（软删除） |

**User's choice:** 先合并 + 软删除（两个信号合并：同话题先合并，删除走软删除归档而非直接 rm）。
**Notes:** 最贴合 CLAUDE.md"遗忘是特性但非破坏性丢失"；现 `mergeTopicMemories` 绕过 store 须修。

### Q2 触发时机

| Option | Description | Selected |
|--------|-------------|----------|
| 启动时清扫 | Agent 启动跑一次，needsConsolidation 门控 | |
| 按次数/定时 | 每 N 次游荡或 N 小时触发 | |
| 留给 Phase 4 | 只接线不自动跑，等反思周期调度 | ✓ |

**User's choice:** 留给 Phase 4。
**Notes:** 与验收标准 #2 冲突 → 见下方"触发冲突"澄清。

### Q3 阈值口径

| Option | Description | Selected |
|--------|-------------|----------|
| 保守默认+可配 | 提取进 agent-config.json，默认 0.2/60 天 | ✓ |
| 维持现状 | 7天/0.3/30天 不动 | |
| 你来定具体值 | 留给 planner | |

**User's choice:** 保守默认 + 可配。

### Q4 可观测性

| Option | Description | Selected |
|--------|-------------|----------|
| 日志+记忆双记 | INFO 日志 + observation 记忆 | ✓ |
| 仅 INFO 日志 | 不进记忆 | |
| 导出清单文件 | 额外清单文件供仪表盘 | ✓（可视化） |

**User's choice:** 日志 + 记忆 + 可视化（双记 + 数据整形好供后续 Web 可视化）。

### Q5 触发冲突澄清（验收标准 #2）

| Option | Description | Selected |
|--------|-------------|----------|
| 加启动一次性触发 | Phase 1 启动跑一次保证有界可验证 | |
| 放宽验收标准 | 只接线+手动可跑，接受本期仍可能无界增长 | ✓ |

**User's choice:** 放宽验收标准。
**Notes:** Phase 1 验收标准 #2 改为"已接线且可手动/单测验证"；planner 须同步 ROADMAP 措辞。

---

## 空游荡行为

### Q1 废除强制 speak 后留什么

| Option | Description | Selected |
|--------|-------------|----------|
| 推送渠道静默 | speak 安静，学习已由 record_knowledge 记录 | |
| 内部标记不推送 | 额外记 observation 标记空游荡 | |
| TUI/仪表盘信号 | 推送静默但 UI 显示状态 | ✓（扩展为节点追踪） |

**User's choice:** （自由文本）"TUI 和仪表盘我希望能记录每一次游荡每一个节点干了什么——搜索? 学习? 记录? 推文?——用户可自行观察宠物"。
**Notes:** 超出"空游荡替代"，是节点追踪/可观测愿景 → 见"追踪归属"澄清。

### Q2 空游荡判定

| Option | Description | Selected |
|--------|-------------|----------|
| 维持现行判定 | spokeTimes===0 且 visitedUrls>0 | |
| 扩展到未分享 | 任何 spokeTimes===0 | ✓ |

**User's choice:** 扩展到未分享。

### Q3 可观测统计

| Option | Description | Selected |
|--------|-------------|----------|
| 统计但不推送 | 空游荡计数进 STAT | ✓ |
| 不单独统计 | 融入现有 STAT | |

**User's choice:** 统计但不推送。

### Q4 追踪归属（范围裁定）

| Option | Description | Selected |
|--------|-------------|----------|
| 数据现在记，UI 留 Phase 6 | 本期保证数据按步记录，节点轨迹 UI 放 Phase 6 | ✓ |
| 纳入 Phase 1 | 扩大范围，需改 ROADMAP | |
| 独立新 phase | 单独插入 | |

**User's choice:** 数据现在记，UI 留 Phase 6。

---

## 工具错误处理

### Q1 ReAct 工具失败去向

| Option | Description | Selected |
|--------|-------------|----------|
| 回喂 LLM 自恢复 | 错误作为 tool result 返给 LLM 决策 | ✓ |
| 显式中止游荡 | 抛出结束本轮 | |
| ERROR 日志+继续 | 现状，违反红线 | |

**User's choice:** 回喂 LLM 自恢复。

### Q2 底层存储 catch

| Option | Description | Selected |
|--------|-------------|----------|
| 分开：未找到 vs 读错 | not found 返 null，读/解析失败抛错 | ✓ |
| 统一抛出 | 任何失败都抛 | |
| 维持现状 | 返 null/false/默认 | |

**User's choice:** 分开：未找到 vs 读错。

### Q3 generateText 整体失败

| Option | Description | Selected |
|--------|-------------|----------|
| 记 ERROR+结束 | 视为致命，结束本轮 | ✓（记录error） |
| 重试 N 次 | 重试后仍失败再结束 | ✓（重试N次） |
| 维持现状 | log + endReason='error' | |

**User's choice:** 记 ERROR + 重试 N 次（两个信号合并）。

### Q4 LLM 统计计数

| Option | Description | Selected |
|--------|-------------|----------|
| 按步回调计数 | AI SDK v6 onStep 每步记一次 | ✓ |
| 维持外层包一次 | 现状 calls=1 | |

**User's choice:** 按步回调计数（API 细节交 researcher 查 Context7）。

---

## Claude's Discretion

- 记忆索引形态（未选讨论）：按 PROJECT.md 锁定方向定默认——JSON sidecar 与 INDEX.md 双写共存，保留人类可读；替代全扫；getMemory 读即写随索引层处理。schema/原子双写/崩溃一致性交 researcher/planner。
- 重试次数 N、onStep 具体 API、archive 目录结构与保留期 → researcher/planner。

## Deferred Ideas

- 游荡节点轨迹 TUI/仪表盘 UI → Phase 6（OBS）
- consolidator 定期/启动自动调度 → Phase 4 反思周期
- 删除死的旧 Planner→Decision→Actions 流水线 → 可选技术债，本期不纳入
- JSON 索引迁 bun:sqlite → v2（SRCH-02）
