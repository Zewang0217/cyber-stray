# Phase 4 Summary: 反思回路

**Goal**: 补齐 manage 半边的核心——周期性 LLM 反思把碎片知识合成成洞察记忆，更新兴趣图谱，闭合"学习→进化"。

**Date**: 2026-06-25
**Status**: Complete
**Mode**: mvp
**Depends on**: Phase 1, Phase 2

## Requirements Verified

- [x] **REF-01**: ReflectionEngine + ReflectionScheduler（异步，每 N 游荡 / 每 M 小时触发）
- [x] **REF-02**: grounding（引用源 memoryId + Zod schema + 无源丢弃）+ 记忆 provenance 标记
- [x] **REF-03**: 反思只读原始观察（provenance ≠ self:reflection）+ 产出洞察记忆 + 更新兴趣图谱

## Files Changed

### 新建

| File | Lines | Purpose |
|------|-------|---------|
| `src/memory/reflection/types.ts` | 124 | Zod schema（ReflectionResult/Insight/NewInterest）+ 类型 + 配置 |
| `src/memory/reflection/engine.ts` | 300 | ReflectionEngine：LLM 驱动碎片→洞察合成，含 grounding 验证 + 兴趣更新 |
| `src/memory/reflection/scheduler.ts` | 183 | ReflectionScheduler：每 5 次游荡 / 4 小时触发，状态持久化 |
| `src/memory/reflection/index.ts` | 22 | 模块 barrel 导出 |
| `src/memory/reflection/engine.test.ts` | 354 | 13 个测试：Zod 校验 / grounding / 观察收集 / 边界 / LLM 异常 |

### 修改

| File | Changes |
|------|---------|
| `src/memory/long-term/types.ts` | MemoryEntry + provenance 可选字段；formatMemoryToMarkdown / parseMemoryFrontmatter 输出/解析 provenance |
| `src/index.ts` | + initReflectionScheduler() 初始化；runHeartbeat 中 runAgentLoop 后调用 scheduler.tick() |

## Key Design Decisions

1. **调度策略**：每 5 次游荡或 4 小时取先到者。状态持久化到 `data/reflection-state.json`。防重叠：正在反思中时跳过新触发。

2. **防自激**：反思只读 `provenance ≠ self:reflection` 的 observation，产出记忆标记 `provenance = self:reflection`，下次反思不读入。

3. **防幻觉（grounding）**：每条洞察必须引用 ≥1 条真实存在的 source memoryId（Zod min(1) + 运行时验证），无源整条丢弃。

4. **部分恢复**：Zod 校验失败时逐个重试 insight，合法保留、非法丢弃（不因一条坏 insight 全丢）。

5. **Markdown 剥离**：start/end 匹配替代 lazy regex（防 content 中的 ``` 导致截断）。

6. **异步不阻塞**：反思在 scheduler.tick() 中异步执行，失败 logger.warn 不阻断主流程。

7. **反思 LLM 参数**：temperature=0.4（需要一致性高于创造性），maxOutputTokens=3000。

## Test Coverage

- 13 个 ReflectionEngine 测试（mock generateText）
- 全量：160 tests, 0 failures

## Verification

```bash
bun run typecheck  # clean
bun test           # 160 pass, 0 fail
```

## What's Not Done (Phase 5)

- 推送价值门控——speak 前用"内容 × 用户模型 × 兴趣"门控决定推送 or 只学
