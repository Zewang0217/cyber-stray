# Review · #76 · S9 反馈回路——点赞/踩 + 顶话题

> 两轴审查 · `review` skill
> 基线 `ce2eab5` (S8) → `7995ad3` (S9) · 单提交 · 22 文件 +1487 / −14
> 日期 2026-08-16

## 基线

| | |
|---|---|
| Fixed point | `ce2eab5` (S8) |
| Target | `7995ad3` (S9) |
| Commit | `feat: S9 反馈回路——点赞/踩 + 顶话题驱动兴趣演化（#76)` |
| Scope | 22 文件 +1487 / −14（跨 agent + control-plane + web 三层） |
| Spec | [issue #76](https://github.com/Zewang0217/cyber-stray/issues/76) |

## Standards

**1 硬违规 / 4 判断题。** 这是目前问题最多的切片。（注：方法/缩进阈值已于 2026-08-16 从硬红线放宽为建议 ≤80 行 / ≤4 层，原 boost handler 硬违规降级。）

通过项：

- **安全硬规矩**（CONTEXT.md）：`feedback.ts` 从 session claim 取 tenant，`x-tenant-*` 忽略；反馈目标限定为该租户宠物（`x-tenant-*` 忽略有测试覆盖）✓
- **数据路径**（conventions.md）：`feedback-store.ts` 调用时求值 `getDataPath('feedback.json')`，无模块级路径常量 ✓
- **DB 改动**（guides/index.md）：migration 0003 仅加 `last_boost_at`（spec #76 授权）；schema 删 `cooldownUntil` 文档注释为无关微改动（判断题）✓
- **web 只读契约**（CONTEXT.md）：`FeedCard`/`useFeedback` 纯 POST `/api/feedback`+`/api/boost`，无直写 agent 数据 ✓
- **plan 节流代码层正确**：`feedback.ts` 按 `pet.plan` 原子 UPDATE `lastBoostAt` 区分 free 30d / pro·byok 1d，匹配 CONTEXT.md ✓

硬违规：

1. **`feedback-pipeline.ts` 8 处 catch 全吞错 + `feedback-cli.ts` 恒 `exit 0`**——`processFeedback` 4 处 + `boostTopic` 新增 4 处 catch 仅 `logger.error`，靠 result 标志传部分成功；`feedback-cli.ts` `main()` 无条件 `exit 0`+`{ok:true}`。结果：**全部步骤失败仍回 HTTP 200 成功，web 误显示「已喜欢」**——直接违反 guides/index.md + conventions.md「禁兜底」红线。**最严重项**——失败不可达 HTTP 层，调用方误以为正常。

判断题：
1. `feedback.ts` boost 路由处理函数 ~64 行（建议 ≤80，合规）——原硬红线已降级，仍建议拆分以改善可读性。
2. `feedback-cli.ts` `console.log/error` 是 CLI 单行 JSON 输出契约（同 S1 cli.ts 模式，允许）。
3. `push-gate.ts:310` 把 boost 计入 `likeRate` 分子（spec 未要求，但可辩护为推送质量校准）。
4. 「免费 1 次/月」实现为固定 30 天而非自然月（语义偏差，但可接受）。

## Spec

**0 硬缺失 / 2 实现有误 / 1 超范围。** 三条验收准则功能上全部实现。

验收对照：
- ✅ 点赞/踩提交生效且驱动兴趣——`/api/feedback` POST 不节流，`processFeedback` 经 InterestGraph reinforce/decay；测试覆盖。
- ✅ 顶话题按 plan 节流，超限被拒——`/api/boost` 按 `pet.plan` 节流（free 30d / pro·byok 1d），原子 UPDATE claim，429 on over-limit，无 spawn。**S7 plan 门控缺口在此真补上**——读真实 `pet.plan` 列。
- ✅ 反馈目标=该租户宠物——session claim 定 tenant，`x-tenant-*` 忽略，petId 限定 session tenant（测试覆盖）。

实现有误：

1. **`boostTopic` 吞所有内部错误仍 `exit 0`——配额 consumed 但兴趣未强化**（最严重）：若 `graph.persist()` 抛错，`feedback.ts` 路由仍保留 `lastBoostAt`（配额回滚键于 worker exit code，而非 `interestReinforced`）。用户配额被消耗但兴趣没被强化。根因同 Standards 硬违规 #1。
2. 「免费 1 次/月」实现为固定 30 天而非自然月——spec 说「月」，实现是 30d 滚动窗口。语义偏差。

超范围：
- `push-gate.ts:310` 把 boost 计入 `likeRate` 分子——spec 未要求，可辩护为推送质量校准。

**最严重**：boost 配额 consumed on internal pipeline failure——根因是 worker 恒 `exit 0` 掩盖失败，与 Standards 硬违规 #1 同源。

## 汇总

| 轴 | 硬违规 | 判断题 | 最严重 |
|---|---|---|---|
| Standards | **1** | 4 | feedback-pipeline 8 处吞错 + worker 恒 exit 0（禁兜底红线） |
| Spec | 0 硬缺失 | 2 实现有误 + 1 超范围 | boost 配额 consumed 但兴趣未强化（根因同上） |

两轴指向**同一根因**：`feedback-cli.ts` 恒 `exit 0` + `feedback-pipeline.ts` 8 处 catch 吞错，导致内部失败不可达 HTTP 层。这既违反禁兜底红线（Standards），又造成 boost 配额 consumed-but-no-reinforce 的用户体验缺陷（Spec）。修复方向：worker 应按 `interestReinforced` 标志决定 exit code，路由按 exit code 回滚配额。

S9 的积极面：S7 的 plan 门控缺口在此真补上（读真实 `pet.plan` 列，free/pro/byok 区分），反馈目标租户隔离有测试，InterestGraph 双驱动闭环成立。
