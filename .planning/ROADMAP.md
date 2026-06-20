# Roadmap: cyber-stray（自进化赛博宠物）

## Overview

把 cyber-stray 从"只记不想"的定时逛网机器人，升级为**自进化的赛博宠物**：补齐记忆系统的 manage 半边（反思/合并/遗忘），加一个由"反思 + 反馈"双驱动的可进化兴趣图谱，以及一道推送价值门控，闭合 探索→学习→反思→进化兴趣→更懂主人→更准推送 的自进化 loop。基于 write-manage-read loop 架构（见 `.planning/research/SUMMARY.md`），全程复用现有 Bun + AI SDK v6 + DeepSeek + Markdown 栈，不换框架。

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): 计划里程碑工作
- Decimal phases (2.1, 2.2): 紧急插入（标 INSERTED）

- [x] **Phase 1: 记忆基础设施** - 索引层 + 接线清理/合并 + 废强制 speak + 修阻塞 bug (completed 2026-06-20)
- [ ] **Phase 2: 可进化兴趣图谱** - 替换冻住 agentInterests → 带权图谱，驱动探索
- [ ] **Phase 3: 用户兴趣模型 + 反馈强化** - 填充 profile + 点赞加权
- [ ] **Phase 4: 反思回路** - 周期 LLM 反思：碎片 → 洞察 → 更新兴趣
- [ ] **Phase 5: 推送价值门控** - speak 前门控；废强制 speak
- [ ] **Phase 6: 兴趣可观测性 + 闭环验证** - 导出/Web 展示进化兴趣；端到端验证 loop

## Phase Details

### Phase 1: 记忆基础设施

**Goal**: 为 manage 半边打地基 —— 记忆索引层（高效检索/反思）、接线 consolidator（有界记忆）、废除强制 speak（让"学习不推送"成立）、修阻塞性 bug。
**Mode**: mvp
**Depends on**: Nothing（first phase）
**Requirements**: MEM-01, MEM-02, MEM-03, MEM-04
**Success Criteria** (what must be TRUE):

  1. 检索/反思不再遍历每个记忆文件（索引命中可观测，检索耗时显著下降）
  2. consolidator 已接线且可通过单测/手动调用验证合并、软删除、过期清理逻辑正确（D-02 放宽口径：本期只接线 + 单测/手动可跑，**不自动周期触发**；定期自动调度属 Phase 4 反思周期。本期 `data/memory/` 仍可能无界增长直到 Phase 4——用户已明确接受）
  3. 空游荡可以"只学习不推送"结束一轮游荡（强制 speak 兜底已移除）
  4. LLM 调用统计反映真实调用次数（不再恒 0）；工具错误显式记录而非空 catch 吞掉

**Plans**: 3/3 plans complete

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — MemoryIndex（JSON sidecar `data/memory/.index.json`）+ types.ts schema 扩展 + MemoryStore 改造（双写钩子 / getMemory 不读即写 / getRecentMemories 走索引 / D-09 错误显式化）+ Wave 0 测试（MEM-01）
- [x] 01-03-PLAN.md — 废除空游荡强制 speak（D-05）+ LLM 统计改 onStepEnd 按步计数（D-11）+ generateText 失败重试（D-10）+ stats.ts 重构（MEM-03/MEM-04）

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — 接线 MemoryConsolidator + cleanupVisitedUrls（启动一次性 best-effort，不自动周期，D-02）+ archive.ts 软删除 + 阈值外置 agent-config.json + D-04 双记（MEM-02）

### Phase 2: 可进化兴趣图谱

**Goal**: 让宠物有可进化的"自我" —— 用带权 InterestGraph 替换冻住的 `agentInterests`，由反思/反馈写入，驱动探索方向，内置防坍缩。
**Mode**: mvp
**Depends on**: Phase 1
**Requirements**: INT-01, INT-02, INT-03
**Success Criteria** (what must be TRUE):

  1. 兴趣不再是冻住的默认值：InterestGraph 可被反思/反馈写入并持久化到 `data/interests.json`
  2. 兴趣随时间可观测变化（权重升降），且不坍缩到单一话题（衰减 + novelty 生效）
  3. 游荡的搜索方向受当前进化兴趣影响（prompt 注入可验证）

**Plans**: 3 plans

Plans:

- [ ] 02-01: InterestGraph 数据结构（带权/来源/lastReinforced）+ 持久化 + 替换 state.agentInterests
- [ ] 02-02: 权重时间衰减 + novelty 探索预算 + 单兴趣上限/数量下限（防坍缩）
- [ ] 02-03: 进化兴趣注入 ReAct prompt，驱动 search_web 方向

### Phase 3: 用户兴趣模型 + 反馈强化

**Goal**: 建立"主人喜欢什么"的模型（当前为空），并用反馈强化画像与兴趣，为推送门控提供依据。
**Mode**: mvp
**Depends on**: Phase 1
**Requirements**: USR-01, USR-02, USR-03
**Success Criteria** (what must be TRUE):

  1. `UserProfile` 不再为空：likes/dislikes 带置信度被记录
  2. 飞书点赞会强化对应画像/兴趣方向（可观测权重变化）
  3. 早期小样本反馈不会把模型锁死在单一方向（置信度随样本校准 + 探索预算生效）

**Plans**: 3 plans

Plans:

- [ ] 03-01: 填充 UserProfile（likes/dislikes/confidence/sampleCount）+ Zod 校验
- [ ] 03-02: 反馈 → 画像 + InterestGraph 加权（兴趣进化的反馈驱动半边）
- [ ] 03-03: 置信度随样本量校准 + 探索预算（防反馈偏差放大）

### Phase 4: 反思回路

**Goal**: 补齐 manage 半边的核心 —— 周期性 LLM 反思把碎片知识合成成洞察记忆，更新兴趣图谱，闭合"学习→进化"。带 grounding 防幻觉、只读原始观察防自激。
**Mode**: mvp
**Depends on**: Phase 1, Phase 2
**Requirements**: REF-01, REF-02, REF-03
**Success Criteria** (what must be TRUE):

  1. 周期反思跑通：碎片知识被合成为洞察记忆，异步于游荡热路径
  2. 洞察可溯源（每条引用源 memoryId + Zod 校验）；无源/低支撑的产出被丢弃而非兜底
  3. 反思只读原始观察类（排除 insight），记忆带 provenance 标记（untrusted:web / self:reflection）
  4. 反思结果更新 InterestGraph（"学习→进化"半边闭合）

**Plans**: 3 plans

Plans:

- [ ] 04-01: ReflectionEngine + 调度器（异步，每 N 游荡 / 启动触发）
- [ ] 04-02: grounding（引用源 memoryId + Zod schema + 无源丢弃）+ 记忆 provenance 标记
- [ ] 04-03: 反思只读原始观察 + 产出洞察记忆 + 更新兴趣图谱

### Phase 5: 推送价值门控

**Goal**: 实现 Core Value 的出口 —— speak 前用"内容 × 用户模型 × 兴趣"门控决定推 or 只学，替换无条件推送，带阈值校准与内容扫描。
**Mode**: mvp
**Depends on**: Phase 2, Phase 3
**Requirements**: PUSH-01, PUSH-02
**Success Criteria** (what must be TRUE):

  1. speak 前有显式门控决策（推送价值分），不再无条件推送
  2. 门控阈值可配置，并能用点赞率在线校准
  3. 推送前有内容/URL 扫描（防 injection），不可信来源内容被降权/拦截

**Plans**: 2 plans

Plans:

- [ ] 05-01: PushGate 决策（内容 × UserProfile × InterestGraph → 推送价值分）+ 接入 speak 调用点
- [ ] 05-02: 阈值可配置 + 点赞率在线校准 + 推送前内容/URL 扫描

### Phase 6: 兴趣可观测性 + 闭环验证

**Goal**: 让"兴趣可观测进化"成功标准可量化 —— 导出/展示兴趣演化、检测坍缩、端到端验证自进化 loop 闭合。
**Mode**: mvp
**Depends on**: Phase 2, Phase 4, Phase 5
**Requirements**: OBS-01, OBS-02, OBS-03
**Success Criteria** (what must be TRUE):

  1. 兴趣图谱演化可导出/在 Web 面板查看（权重随时间曲线）
  2. 有兴趣坍缩检测（兴趣熵告警）
  3. 端到端验证：探索 → 学习 → 反思 → 兴趣进化 → 更准推送 的 loop 闭合可证

**Plans**: 3 plans

Plans:

- [ ] 06-01: 兴趣图谱演化导出/日志（权重时间序列）
- [ ] 06-02: Web 面板展示进化兴趣 + 兴趣熵/坍缩检测告警
- [ ] 06-03: 端到端验证自进化 loop（探索→学习→反思→进化→推送 闭环用例）

## Progress

**Execution Order:**
Phases execute in numeric order；Phase 2/3 在 Phase 1 后可相对并行（弱依赖），Phase 4 依赖 1+2，Phase 5 依赖 2+3，Phase 6 依赖 2+4+5。

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. 记忆基础设施 | 3/3 | Complete   | 2026-06-20 |
| 2. 可进化兴趣图谱 | 0/3 | Not started | - |
| 3. 用户兴趣模型+反馈强化 | 0/3 | Not started | - |
| 4. 反思回路 | 0/3 | Not started | - |
| 5. 推送价值门控 | 0/2 | Not started | - |
| 6. 兴趣可观测性+闭环验证 | 0/3 | Not started | - |
