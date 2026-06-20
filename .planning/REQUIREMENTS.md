# Requirements: cyber-stray（自进化赛博宠物）

**Defined:** 2026-06-20
**Core Value:** 让赛博宠物闭环自进化——被自己进化的好奇心驱动探索学习，并主动推送主人感兴趣的内容。

## v1 Requirements

基于 `.planning/research/SUMMARY.md`（write-manage-read loop）+ PROJECT.md 的 6 块 Active。每类目映射到一个 phase（详见 Traceability）。

### MEM — 记忆基础设施

- [x] **MEM-01**: 新增 JSON 索引 sidecar（`data/memory/.index.json`），记忆检索/反思不再 O(N) 全文件扫描
- [x] **MEM-02**: 接线 `MemoryConsolidator` + `cleanupVisitedUrls`，记忆有界（合并同话题 / 清理低价值 / 过期遗忘）
- [x] **MEM-03**: 废除空游荡强制 speak 兜底（`src/agent/react.ts:209`），让"学习但不推送"成立
- [x] **MEM-04**: 修阻塞性 bug —— LLM 调用统计恒 0（`src/llm/stats.ts` 未接线）、空 catch 静默失败（遵 CLAUDE.md 显式报错）

### INT — 可进化兴趣图谱

- [ ] **INT-01**: `InterestGraph` 替换冻住 `state.agentInterests`，带权/来源/lastReinforced/时间衰减，持久化 `data/interests.json`
- [ ] **INT-02**: 防坍缩 —— 权重衰减 + novelty 探索预算 + 单兴趣权重上限 / 数量下限
- [ ] **INT-03**: 进化兴趣注入 ReAct prompt，驱动搜索方向

### USR — 用户兴趣模型 + 反馈强化

- [ ] **USR-01**: 填充 `UserProfile`（likes/dislikes/置信度），当前 `data/memory/user-profile.json` 为空
- [ ] **USR-02**: 飞书反馈 → 画像 + 兴趣加权（兴趣进化的"反馈驱动"半边）
- [ ] **USR-03**: 置信度随样本量校准 + 探索预算（防早期反馈偏差放大）

### REF — 反思回路

- [ ] **REF-01**: `ReflectionEngine` 周期性 LLM 反思，碎片知识 → 洞察记忆（异步于游荡热路径）
- [ ] **REF-02**: 反思 grounding —— 洞察引用源 memoryId + Zod 校验，无源/低支撑即丢弃（不兜底）
- [ ] **REF-03**: 反思只读原始观察类 + 记忆 provenance 标记（`untrusted:web` / `self:reflection`），防自激写放大 + 学习内容 injection

### PUSH — 推送价值门控

- [ ] **PUSH-01**: `PushGate`（内容 × UserProfile × 兴趣 → 推送价值分），speak 前决策"推 or 只学"
- [ ] **PUSH-02**: 门控阈值可配置 + 用点赞率在线校准 + 推送前内容/URL 扫描（防 injection + 过严/过松）

### OBS — 兴趣可观测性

- [ ] **OBS-01**: 兴趣图谱演化导出/日志（权重随时间变化，量化"可观测进化"成功标准）
- [ ] **OBS-02**: Web/面板展示进化兴趣 + 兴趣熵/坍缩检测告警
- [ ] **OBS-03**: 端到端验证自进化 loop 闭合（探索 → 学习 → 反思 → 进化 → 更准推送）

## v2 Requirements

已认领但 defer，不在当前路线图。

### 检索增强

- **SRCH-01**: 语义向量检索（本地 embedding，如 `@xenova/transformers`），补齐 keyword 召回不足
- **SRCH-02**: JSON 索引 sidecar 迁移到 `bun:sqlite`（当记忆/查询规模增长到 JSON 吃力时）

## Out of Scope

显式排除，防 scope creep（理由见 PROJECT.md）。

| Feature | Reason |
|---------|--------|
| 整体换 agent 框架（Letta/MemGPT 接管） | 已有跑通的 ReAct loop，迁移成本巨大、收益错位 |
| 多 agent 社会（Generative Agents 小镇） | scope 爆炸、成本激增；单宠物闭环先做扎实 |
| Web 仪表盘生产鉴权 | 独立安全工作，与自进化核心无关 |
| 删除死的旧 Planner→Decision→Actions 流水线 | 独立技术债清理；可作为 Phase 1 选办项，不纳入自进化核心主线 |
| 新推送渠道 / 新搜索 provider | 非自进化核心；现有飞书/Telegram + DDG/Tavily/Exa 足够 |
| 完全自主目标设定（无界 autonomy） | 不可预测、安全难控；兴趣图谱驱动探索但边界可观测可控 |
| 无限保留所有记忆 | 与自进化相悖——遗忘是特性（已由 MEM-02 覆盖） |

## Traceability

> 初版映射（基于研究 SUMMARY.md 的 phase 建议）；`gsd-roadmapper` 在 ROADMAP.md 定稿时复核。

| Requirement | Phase | Status |
|-------------|-------|--------|
| MEM-01 | Phase 1 | Complete |
| MEM-02 | Phase 1 | Complete |
| MEM-03 | Phase 1 | Complete |
| MEM-04 | Phase 1 | Complete |
| INT-01 | Phase 2 | Pending |
| INT-02 | Phase 2 | Pending |
| INT-03 | Phase 2 | Pending |
| USR-01 | Phase 3 | Pending |
| USR-02 | Phase 3 | Pending |
| USR-03 | Phase 3 | Pending |
| REF-01 | Phase 4 | Pending |
| REF-02 | Phase 4 | Pending |
| REF-03 | Phase 4 | Pending |
| PUSH-01 | Phase 5 | Pending |
| PUSH-02 | Phase 5 | Pending |
| OBS-01 | Phase 6 | Pending |
| OBS-02 | Phase 6 | Pending |
| OBS-03 | Phase 6 | Pending |

**Coverage:**

- v1 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-20*
*Last updated: 2026-06-20 after initial definition*
