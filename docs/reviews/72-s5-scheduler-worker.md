# Review · #72 · S5 调度器 + 短命 worker 生命周期

> 两轴审查 · `review` skill
> 基线 `cc10074` (S4) → `47ad4ee` (S5) · 单提交 · 14 文件 +1563 / −3
> 日期 2026-08-16

## 基线

| | |
|---|---|
| Fixed point | `cc10074` (S4) |
| Target | `47ad4ee` (S5) |
| Commit | `feat(control-plane): S5 调度器 + 短命 worker 生命周期（#72)` |
| Scope | 14 文件 +1563 / −3 |
| Spec | [issue #72](https://github.com/Zewang0217/cyber-stray/issues/72) |

## Standards

**1 硬违规 / 6 判断题。**

**通过项**：
- **无 Redis / 无常驻进程**（CONTEXT.md）：`events/bus.ts` 进程内 Map 总线（非 Redis pub/sub）；scheduler 嵌入控制面 `setInterval` tick，非每宠物常驻 ✓
- **禁 execSync**（conventions.md）：`worker-runner.ts` 用 `spawn` + `Promise.withResolvers` + `setTimeout`/`SIGKILL` 超时，无 execSync ✓
- **DB 改动**（guides/index.md）：migration 0001 加 `pets.cooldown_until` 在 spec #72 授权范围内；另重建 `user_tenants`（同列、保数据，drizzle 规范化产物，与调度器无关，判断题：无害）
- **禁兜底**：`scheduler.ts:110` `tick().catch` 是文档化的 log-and-continue（调度器不该崩，合理）；`:240` 冷却分支持久化失败状态，非吞；`bus.ts:54` 订阅者隔离 catch 有文档+测试，非掩盖；`worker-runner.ts:136` catch 记录 + 返回 `{ok:false}`，错误经结果契约传播 ✓
- **魔法值**：并发上限 `schedulerMaxConcurrent=4`、propagate 阈值 `READY_BOREDOM=70`/`READY_ENERGY=40` 等均抽常量 ✓

**硬违规**：
1. `scheduler/scheduler.ts` `launch()` ~85 行 + 4 层缩进（async IIFE→try→if/else→body），违反 guides/index.md「方法≤50 行 / 缩进≤3 层（Guard Clause 优先）」。该方法把成功写回、重试 lease、DB 冷却、gen 令牌所有权四件事捆在一起。**最严重项**——需拆分为独立方法。

判断题：
1. migration 0001 重建 `user_tenants` 与调度器无关（drizzle 规范化，无害）。
2. `config.ts` 数值在 return 里重算而非复用（轻微冗余）。
3. `worker-runner.ts` `createWorkerRunner` 缺直接 JSDoc（模块头覆盖）。
4. `scheduler.ts:110` tick 失败 log-and-continue（合理）。
5. 各处 `console.error`/`console.log` 均为运行日志（非调试遗留）。
6. `bus.ts:54` 订阅者隔离 catch（有测试，非掩盖）。

## Spec

**0 硬缺失 / 0 实现有误 / 0 超范围。** 四条验收准则全部命中。

验收对照：
- ✅ 无常驻宠物进程——`scheduler.tick()` 扫 pets 表→propagate→isReady→spawn 短命 worker→成功写回 `lastRunAt`/`boredom`/`energy`→退出；worker 经 S1 入口（`worker-runner.ts` 拉起 `agent/src/worker/cli.ts`→`runOneWander`）。
- ✅ 并发上限生效——`config.ts` 默认 `schedulerMaxConcurrent=4`（落在 spec 的 4–6），tick 内 `running.size >= maxConcurrent` 拦停。
- ✅ worker 崩溃 lease/重试兜底——`leases` Map（`retries`+`nextEligibleAt` 退避）+ TTL 挂死重认领（gen 令牌防旧任务误写/误删）+ DB `cooldown_until` 保重启安全。
- ✅ 事件路由到租户——`bus.publish(tenantId, ev)` / `subscribe(tenantId, handler)`，订阅者隔离，为 S8 SSE 预留。

测试覆盖：`scheduler.test.ts`（就绪拉起/写回/并发上限/崩溃重试/超限冷却/挂死重认领/跨租户隔离）、`propagate.test.ts`（前推/夹取/elapsed=0/null lastRunAt/阈值）、`worker-runner.test.ts`（args/退出码/secrets 注入清理/超时）、`bus.test.ts`（租户路由/多订阅/退订/隔离/无订阅）。

**最严重**：无——spec 四准则全部达成，worker 经 S1 入口、lease+gen 令牌+DB 冷却三重兜底完整。

## 汇总

| 轴 | 硬违规 | 判断题 | 最严重 |
|---|---|---|---|
| Standards | **1** | 6 | `scheduler.ts` `launch()` ~85 行 + 4 层缩进（方法≤50/缩进≤3 硬红线） |
| Spec | 0 | 0 | 无 |

S5 的 Spec 轴满分（四准则全命中，三重兜底完整），但 Standards 轴有唯一硬违规：`launch()` 方法过长+过深，捆绑了写回/重试/冷却/所有权四职责，需拆分。这是纯结构问题，不影响功能正确性。
