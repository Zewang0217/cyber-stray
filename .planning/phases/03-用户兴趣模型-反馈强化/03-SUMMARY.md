# Phase 3 Summary: 用户兴趣模型 + 反馈强化

**Goal**: 建立"主人喜欢什么"的模型，并用反馈强化画像与兴趣，为推送门控提供依据。

**Date**: 2026-06-25
**Status**: Complete
**Mode**: mvp
**Depends on**: Phase 1, Phase 2

## Requirements Verified

- [x] **USR-01**: UserProfile Zod schema + 错误显式化 + sampleCount 无界字段
- [x] **USR-02**: 飞书反馈 → 画像 + 兴趣加权（反馈管道）
- [x] **USR-03**: 置信度 sigmoid 校准 + 探索预算（防早期反馈锁死）

## Files Changed

### 新建

| File | Lines | Purpose |
|------|-------|---------|
| `src/memory/feedback-pipeline.ts` | 172 | 反馈管道：编排 messageId→话题映射 + 画像更新 + InterestGraph.reinforce 全链路 |
| `src/memory/feedback-pipeline.test.ts` | 250 | 反馈管道测试：like/dislike 链路、降级容错、容量控制、防偏差 |
| `src/memory/user-profile.test.ts` | 204 | UserProfile 测试：schema 校验、sigmoid 置信度、旧数据迁移、冷却期 |

### 修改

| File | Changes |
|------|---------|
| `src/memory/user-profile.ts` | +Zod schema + sampleCount 无界字段 + loadUserProfile 解析/schema 失败抛错 + sigmoid 置信度 |
| `src/tools/push/speak.ts` | +registerSpeakTopics 调用（推送成功后注册消息-兴趣映射） |
| `src/tools/feishu/ws-client.ts` | 替换旧 recordFeedback+updateMoodByFeedback → processFeedback 管道 |

## Key Design Decisions

1. **sigmoid 置信度** `confidence = sampleCount/(sampleCount+K), K=10`：1 样本 → 9%，5 → 33%，10 → 50%，上限 0.95。比旧线性公式 `feedbackCount/20` 更保守，小样本不致锁死方向。

2. **内存消息-兴趣映射**：Map<messageId, topics[]>，speak 时注册，反馈时查找。重启丢失（反馈通常在数分钟内到达），容量上限 200 条防泄漏。

3. **反馈 → 兴趣自动创建**：like 不存在的兴趣时自动 `addInterest(topic, 0.3, 'feedback')`，source='feedback' 与 Phase 4 的 'reflection' 并列。

4. **dislike 衰减**：直接降权重 `max(0, weight - 0.1)`，不删节点让时间衰减自然收尾。

5. **各环节独立容错**：feedback-store、UserProfile、InterestGraph 任一失败不阻断其他环节。

## Test Coverage

- 16 个 UserProfile 测试（schema / 迁移 / sigmoid / 冷却期）
- 14 个 FeedbackPipeline 测试（like/dislike 链路 / 降级 / 容量 / 防偏差）
- 全量：147 tests, 0 failures

## Verification

```bash
bun run typecheck  # clean
bun test           # 147 pass, 0 fail
```

## What's Not Done (Phase 4)

- 反思回路（周期 LLM 反思 → 碎片合成洞察 → 更新兴趣图谱）
- InterestGraph source='reflection' 接入
- 推送价值门控（Phase 5）
