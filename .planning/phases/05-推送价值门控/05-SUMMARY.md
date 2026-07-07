# Phase 5 Summary: 推送价值门控

**Goal**: 实现 Core Value 的出口——speak 前用"内容 × 兴趣图谱 × 用户画像"门控决定推 or 只学，替换无条件推送。

**Date**: 2026-06-25
**Status**: Complete
**Mode**: mvp
**Depends on**: Phase 2, Phase 3

## Requirements Verified

- [x] **PUSH-01**: PushGate 决策（内容 × UserProfile × InterestGraph → 推送价值分）+ 接入 speak 调用点
- [x] **PUSH-02**: 阈值可配置 + 点赞率在线校准 + 推送前内容/URL 扫描

## Files Changed

### 新建

| File | Lines | Purpose |
|------|-------|---------|
| `src/memory/push-gate.ts` | 410 | PushGate 类：评分引擎 + 阈值校准 + 内容扫描 |
| `src/memory/push-gate.test.ts` | 202 | 16 个测试：评分公式 / 门控决策 / 内容扫描 / 阈值校准 / 边界 |

### 修改

| File | Changes |
|------|---------|
| `src/types.ts` | AgentConfig + pushGate 配置类型（嵌套 weights/calibration/contentScan） |
| `src/config.ts` | BehaviorConfig + pushGate 默认值 + 三层嵌套合并（同 consolidation/interests 模式） |
| `src/tools/registry/speak.ts` | execute 中接入 PushGate.evaluate() → 低于阈值拦截 + URL 去重；导入 getPushGate |
| `src/tools/push/speak.ts` | SpeakResult + gated/gateScore/gateReasons 可选字段 |
| `data/agent-config.json` | + pushGate 配置段（带注释） |

## Key Design Decisions

1. **评分公式**: `pushScore = 0.4×interestRelevance + 0.4×userPreference + 0.2×contentQuality`。兴趣和用户偏好各占 40%，内容质量占 20%——"主人喜不喜欢"比"内容写得怎么样"重要。

2. **门控失败默认放行**: PushGate.evaluate() 抛错时 catch + warn，不阻断 speak 热路径。宁可多推一条也不丢失内容。

3. **兴趣相关度**: 内容关键词与 InterestGraph Top 10 兴趣节点做子串匹配，命中权重占比为得分。无兴趣数据时返回 0.5 中性分。

4. **用户偏好**: 基础分 0.5 + 每个 like 命中 +0.15 − 每个 dislike 命中 −0.2，置信度调节（低置信度时向 0.5 回归）。

5. **内容质量**: article=0.8, share=0.6, nonsense=0.4 基础分，+ URL/长度加分。

6. **阈值校准**: 基于 feedback-store 最近 20 条反馈的点赞/踩率。高点赞率(≥70%) → 降阈值(更宽松)，高踩率(≥30%) → 升阈值(更严格)。阈值限幅 [0.3, 0.8]。

7. **内容安全扫描**: URL 数量检查(maxUrlCount=5) + 9 个 prompt injection 正则模式匹配。有警告时额外扣分。

8. **门控 URL 去重**: 拦截时也记录 URL——避免 LLM 反复尝试推同一链接。

## Test Coverage

- 16 个 PushGate 测试（mock InterestGraph/UserProfile/FeedbackStore）
- 全量：176 tests, 0 failures

## Verification

```bash
bun run typecheck  # clean
bun test           # 176 pass, 0 fail
```

## What's Not Done (Phase 6)

- 兴趣可观测性 + 闭环验证——兴趣图谱演化导出/Web 展示 + 坍缩检测 + 端到端验证自进化 loop
