# Review · #75 · S8 首推闭环 + 推送理由 + SSE 应用内实时

> 两轴审查 · `review` skill
> 基线 `8a1be73` (S7) → `ce2eab5` (S8) · 单提交 · 22 文件 +502 / −29
> 日期 2026-08-16

## 基线

| | |
|---|---|
| Fixed point | `8a1be73` (S7) |
| Target | `ce2eab5` (S8) |
| Commit | `feat: S8 首推闭环 + 推送理由 + SSE 应用内实时（#75)` |
| Scope | 22 文件 +502 / −29（跨 agent + control-plane + web 三层） |
| Spec | [issue #75](https://github.com/Zewang0217/cyber-stray/issues/75) |

## Standards

**0 硬违规 / 3 判断题。**

通过项：

- **SSE 租户隔离**（CONTEXT.md「每条连接绑定 tenant id，不跨租户泄漏」）：`events.ts` 从 session claim 取 tenant + `userTenants` 关系校验（403）+ `bus.subscribe(tenantId)` 只收本租户通道；`events.test.ts` 断言 alice 流不含 bob ✓
- **无 Redis**（CONTEXT.md）：事件走 S5 进程内 `EventBus`（`app.ts`/`index.ts` 单 bus 实例注入 app + scheduler）✓
- **降级轮询兜底**（CONTEXT.md「SSE 不稳降级轮询」）：`useTenantEvents.ts` `onerror`→`connected=false`→各 hook 回落定时轮询（`useAgentState` 5s / `useHistory` 15s / `useInterestGraph` 30s）；`EventSource retry:5000` 自动重连 ✓
- **工具 trace**（conventions.md）：`registry/speak.ts` 仍调 `pushWanderStep` 汇入 `wanderHistory` ✓
- **PushGate 保留**（conventions/index.md）：`quality.ts` `beforeToolCall` speak 前评分保留，新增 `gateReasons` 透传 ✓
- **web 只读契约**：`FeedCard`/`useTenantEvents` 纯消费 SSE + API，无写 agent 数据 ✓
- **agent 侧 catch 块**（quality.ts:51/95/134/140、speak.ts:46/165/179/194）均为 S7 既有，S8 未触碰，不构成新违规 ✓

判断题：

1. `events.ts:51-104` SSE 路由 handler 约 51 行（建议 ≤80，合规）。
2. `pets.ts:177-179` `boredom 30→75`（魔法值，注释指向阈值 70）——属「首推闭环」功能点，非 SSE 必要改动，但 commit 消息显式纳入 S8 范围。
3. 单提交捆绑首推闭环 + 推送理由 + SSE 三个功能点（guides「一个提交 = 一个逻辑单元」边界判断，但 spec #75 本身就是三合一）。

**最严重**：events.ts 路由 handler 约 51 行——轻微超限，可拆分。

## Spec

**0 硬缺失 / 0 实现有误 / 1 轻微超范围。** 五条验收准则全部命中。

验收对照：
- ✅ 领养用户合理时间收到首推——`pets.ts` 领养设 `boredom=75 ≥ READY_BOREDOM=70`→60s 内 scheduler 拉起 worker→`runOneWander`→`speak(PushGate)`→push。
- ✅ 推送流展示内容 + 推送理由——全链路：`quality.ts` `gateReasons` → `history-record.ts` 落盘 speaks-*.jsonl → `data.ts` `normalizeRecord` 白名单透出 → `FeedCard` 渲染「为什么推给我」。
- ✅ SSE 应用内实时 + 租户隔离——`events.ts` SSE 端点：session 鉴权（401）+ membership（403）+ `bus.subscribe(tenantId)` 单租户通道；`events.test.ts` 断言 alice 流不含 bob。
- ✅ 降级轮询兜底——`useTenantEvents` `onerror`→回落轮询；SSE 连通时降频 60s。
- ✅ 事件由调度器经进程内总线送达——`index.ts:33` 单 bus 实例共享 app+scheduler，调度器发布六类生命周期事件；时序正确（`worker_succeeded` 在 JSONL 写完后触发，refetch 无竞态）。

轻微超范围：
- `quality.ts` 顺带重置 `matchedTopics` 残留——实际是 S9 反馈归因的正确性修复（`evaluate` 抛错走默认放行时不泄漏上一步理由），合理。

设计判断（非问题）：
- 「合理时间收到首推」为 best-effort——受 PushGate 红线约束，冷兴趣图谱可能只产 gated 杂谈，硬保证会违反门控铁律。属可接受解释。
- SSE 推的是生命周期信号而非推送内容/状态负载本身——「状态/推送实时」靠 SSE 触发 refetch 达成，属可接受架构。

**最严重**：无硬问题。

## 汇总

| 轴 | 硬违规 | 判断题 | 最严重 |
|---|---|---|---|
| Standards | 0 | 3 | `pets.ts` boredom 30→75 魔法值（注释指向阈值 70，两处重复） |
| Spec | 0 | 0（1 轻微超范围，实为正确性修复） | 无 |

S8 是跨三层的高质量切片：首推闭环（boredom 阈值触发）+ 推送理由全链路（agent 产出→落盘→control-plane 透出→web 展示）+ SSE 租户隔离 + 降级轮询，五条准则全命中。agent 侧未引入新违规（catch 块为 S7 既有）。
