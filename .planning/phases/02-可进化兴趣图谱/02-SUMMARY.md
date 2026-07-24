# Phase 2: 可进化兴趣图谱 — 执行总结

> **Phase:** 02-可进化兴趣图谱
> **Status:** Complete
> **Completed:** 2026-06-25
> **Branch:** feat/02-interest-graph
> **Commit:** 31438dd

---

## 需求覆盖

| Requirement | Status | Deliverable |
|-------------|--------|-------------|
| **INT-01** | ✅ Complete | `InterestGraph` 替换冻住 `state.agentInterests`，持久化 `data/interests.json` |
| **INT-02** | ✅ Complete | 权重衰减 + novelty 探索预算 + 单兴趣上限/数量下限 + 兴趣熵 |
| **INT-03** | ✅ Complete | 进化兴趣注入 ReAct prompt，驱动搜索方向 |

---

## 交付物

### 新建文件

| 文件 | 说明 |
|------|------|
| `src/memory/interest-graph.ts` | InterestGraph 核心模块（~500 行） |
| `src/memory/interest-graph.test.ts` | 23 个测试 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/config.ts` | 新增 `interests` 配置段（decayLambda/maxWeight/minInterestCount/noveltyBudget/defaultSeeds/minWeight），W2 嵌套合并 |
| `src/types.ts` | `AgentConfig` 新增 `interests` 可选字段；`agentInterests` 标记 `@deprecated` |
| `src/agent/state.ts` | `loadState()` 从 InterestGraph 同步 `agentInterests`（派生字段） |
| `src/prompts/react.ts` | `buildReactSystemPrompt` 从 InterestGraph 读取带权兴趣，格式：`- 科技 [热情度: 72%]` |
| `src/memory/long-term.ts` | barrel export 新增 interest-graph |

---

## 架构设计

### InterestGraph 数据结构

```typescript
interface InterestNode {
  id: string;              // 兴趣主题
  weight: number;          // 权重 0-1（当前有效权重）
  source: 'default' | 'reflection' | 'feedback';
  createdAt: string;       // ISO 创建时间
  lastReinforced: string;  // ISO 最后强化时间
  reinforceCount: number;  // 被强化次数
}

interface InterestGraphData {
  version: 1;
  lastUpdated: string;
  nodes: InterestNode[];
}
```

### 核心行为

| 方法 | 说明 |
|------|------|
| `getTopInterests(n, minWeight?)` | 返回已衰减的 top N 兴趣 ID |
| `getTopInterestsWithWeights(n)` | 返回带权重的 top N |
| `reinforce(id, delta)` | 强化权重（上限封顶） |
| `addInterest(id, weight, source)` | 新增（novelty 预算检查） |
| `decayAll()` | 应用时间衰减 + 清理 dormant + 补充下限 |
| `getEntropy()` | Shannon 熵（坍缩检测） |
| `seedDefaults()` | 从 defaultSeeds 初始化 |

### 防坍缩机制

1. **时间衰减**: `weight * exp(-λ * Δt_days)`
2. **单兴趣上限**: `maxWeight`（默认 0.8）
3. **数量下限**: `minInterestCount`（默认 3），低于时从 `defaultSeeds` 补充
4. **Novelty 预算**: 新兴趣总权重 ≤ 1.0 + `noveltyBudget`
5. **Dormancy 阈值**: 衰减后低于 `minWeight`（默认 0.05）移除

### 配置项

```json
{
  "interests": {
    "decayLambda": 0.1,
    "maxWeight": 0.8,
    "minInterestCount": 3,
    "noveltyBudget": 0.15,
    "defaultSeeds": ["科技", "AI", "互联网"],
    "minWeight": 0.05
  }
}
```

---

## 测试

- **117 pass / 0 fail**（全部 12 个测试文件）
- 新增 23 个 InterestGraph 专项测试覆盖：加载/持久化、衰减、上限、novelty 预算、数量下限、熵计算、单例、初始化

---

## 集成点

| 集成点 | 说明 |
|--------|------|
| `src/index.ts` | `initializeInterestGraph()` 在启动时调用（后续可挂 `runStartupMemoryMaintenance`） |
| `src/agent/state.ts` | `loadState()` 从 InterestGraph 同步 `agentInterests` |
| `src/prompts/react.ts` | prompt 注入动态兴趣（带权重） |
| `src/config.ts` | 配置嵌套合并（W2 模式） |

---

## 关键决策

| 决策 | 理由 |
|------|------|
| `agentInterests` 保留为派生字段 | 兼容现有 Web UI / TUI 读取点，避免破坏性变更 |
| source 预留 'reflection'/'feedback' | Phase 3/4 接入时无需改数据结构 |
| 兴趣图谱直接移除（非归档） | 量级小，无需像记忆那样软删除；dormant 兴趣无历史价值 |
| 启动时应用一次衰减 | 清理过旧兴趣，保持图谱新鲜 |

---

## 遗留 / 下一步

- **Phase 3 (USR)**: 反馈 → InterestGraph 加权（`source: 'feedback'`）
- **Phase 4 (REF)**: 反思 → InterestGraph 更新（`source: 'reflection'`）
- **Phase 6 (OBS)**: 兴趣演化导出/日志（权重时间序列）

---

## 验证清单

- [x] `data/interests.json` 创建并包含带权节点
- [x] `loadState()` 后 `agentInterests` 与 `InterestGraph.getTopInterests()` 一致
- [x] Prompt 中包含兴趣权重信息
- [x] 衰减后权重正确（单测）
- [x] 权重上限封顶（单测）
- [x] 数量下限补充（单测）
- [x] 兴趣熵计算（单测）
- [x] 所有现有测试仍通过（117/117）

---

*Summary created: 2026-06-25*
