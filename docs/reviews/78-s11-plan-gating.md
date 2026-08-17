# Review · #78 · S11 Plan 门控与节流——推送频率/操控节流、BYOK、Pro 推送窗口

> 两轴审查 · `review` skill
> 基线 `6cf2837` (S10) → `1309176` (S11) · 单提交 · 30 文件 +1836 / −45
> 日期 2026-08-16

## 基线

| | |
|---|---|
| Fixed point | `6cf2837` (S10) |
| Target | `1309176` (S11) |
| Commit | `feat: S11 Plan 门控与节流——推送频率/操控节流按套餐、BYOK 自带 key、Pro 自定义推送时间（#78)` |
| Scope | 30 文件 +1836 / −45（跨 agent + control-plane + web 三层） |
| Spec | [issue #78](https://github.com/Zewang0217/cyber-stray/issues/78) |

## Standards

**3 硬违规（双轴共 6 findings，全部修复） / 2 判断题。**

通过项：

- **安全硬规矩**（CONTEXT.md）：`plan.ts` 租户只从 session JWT 取，`x-tenant-*` 忽略（`plan.test.ts` 注入 x-tenant-id=bob 断言仍按 session 走）；BYOK key 走 S4 `openTenantSecrets` 信封加密（`byok-key` → `deepseek_api_key`，测试回读明文 + GET 不回显）✓
- **BYOK 不烧平台 token**（epic #67「BYOK 重用户自带 key」）：三处 provider 读取点（`loadConfig` 组装、`WanderAgent.getProvider`、`reflection callLLM`）+ `validateConfig` 均按 `plan==='byok'` 挡 env 回退，缺 key 显式抛错——平台 key 不替 BYOK 用户烧 ✓
- **只卡到达主人，不卡自进化**（epic「核心价值永不付费墙」）：预算/窗口只拦推送投递，内容照常落盘（planLimited 标记），学习/记忆/游荡不受影响 ✓
- **DB 改动**（guides/index.md）：migration 0005 加 `push_window_start/end`（spec #78 授权）；`plan` 列 S7 已有，S11 仅消费 ✓
- **web 只读契约**：`usePlan`/settings 纯消费 `/api/plan*` API，无直写 agent 数据 ✓
- **web 推送时间窗与网关同源**：`withinPushWindow` 纯函数（跨午夜语义），gateway 侧同判据手写一次（可抽共享但两侧判据一致，判断题）✓

硬违规（review 发现并已修复）：

1. **预算计数日期键错位——UTC 文件 vs 本地键，每日存在绕过窗口**（P1，push-budget.ts）：`speak()` 写 `speaks-<UTC 日期>.jsonl` 而 `countGatePassedToday` 用本地日期键比对 UTC 时间戳 `slice(0,10)`——UTC+8 每日 00:00–08:00 本地日期≠UTC 日期，计数恒 0，free 用户可无限推。**已修**：日期键与文件名同源（`localDateKey()`/`todaySpeaksFile()` 本地日期，`appendSpeakHistory` 同源），计数不再比对时间戳。
2. **`countGatePassedToday` 未排除 planLimited 记录——窗口外/超限落盘记录虚耗日预算**（P2，push-budget.ts）：计数只跳过 `gated`，planLimited 记录全部计入 used——带推送窗口的 Pro 用户窗口外游荡会吃光日预算，窗口内正常推送被误拦。**已修**：`planLimited === true` 与 `gated` 同判跳过。
3. **gateway 窗口注释承诺"窗口内补发"但实现是永久丢弃**（P2，push-gateway.ts）：agent 窗口外内容标 planLimited → `latestNotifiableSpeak` 跳过 → gateway 的窗口检查只对非 planLimited 记录生效（竞态防御），注释与实现矛盾。**已修**：注释对齐真实语义（窗口外=免打扰不补发；gateway 窗口检查仅兜"speak 窗内放行、事件处理跨出窗口"竞态，该内容非 planLimited 且不回滚基线 → 窗口内补发可达）。

判断题：

1. `usePlan.mutate` 网络失败/非 JSON 响应最初未捕获（unhandled rejection + 无反馈）——**已修**：try/catch 包住，失败 setError + return false（与 `refresh()` 静默处理不同：写路径需要显式反馈）。
2. gateway 窗口判据手写而非复用 `withinPushWindow`（跨包不可直接 import；判据一致，测试双端覆盖）。

**最严重（已修）**：日期键错位——免费用户可在每日 0-8 点绕过 5 条/日上限，直接违反 AC #1。

## Spec

**0 硬缺失 / 0 实现有误 / 1 设计判断。** 四条验收准则全部达成，双轴共 6 findings 全部修复后复测全绿。

验收对照：
- ✅ **推送频率按 plan 限制生效**——`plan/limits.ts` 统一策略源（free 5/天、pro/byok 20/天）；agent `speak()` gate 放行后判日预算（`countGatePassedToday` 数今日文件非 gated 非 planLimited 记录）→ 超限落盘标 `planLimited` 不投递；push-gateway `latestNotifiableSpeak` 跳过 planLimited（Web Push 不能绕过套餐预算）；纯 PWA 租户（无渠道 pushed=false）仍按文件计数 ✓。
- ✅ **操控节流按 plan 生效**（免费 1/月、Pro 1/天）——`feedback.ts` boost 原子占位（S9 实现）收编 `planLimits().boostIntervalMs`（free 30d / pro+byok 1d），行为不变，测试保留。
- ✅ **BYOK 透传自带 key，平台不烧 token**——`PUT /api/plan/byok-key`（S4 加密存 `deepseek_api_key`）→ worker-runner `SECRET_FIELD_BY_NAME` 注入 `AgentSecrets.deepseekApiKey` → agent 三处 provider 读取点按 `plan==='byok'` 挡 env 回退，缺 key 显式抛错。全链闭环 ✓。
- ✅ **Pro 用户可自定义推送时间**——`pets.push_window_start/end`（迁移 0005）+ `PUT/DELETE /api/plan/push-window`（仅 pro/byok，0-23 整数、start≠end、支持跨午夜 22-6）+ scheduler `--plan-args` JSON 注入 + agent speak 窗口检查 + gateway 竞态防御，双端判据一致 ✓。

设计判断：
- 「免费 1 次/月」实现为固定 30 天滚动窗口而非自然月——S9 review 已判可接受（判断题），S11 收编时延续，不重复处理。

## 跨切片遗留项（非 S11 引入，但 S11 直接承载）

- **S9 最严重项未修**（`76-s9-feedback-loop.md` 硬违规 #2）：`feedback-cli.ts:151` 仍无条件 `process.exit(0)` + pipeline 8 处 catch 吞错——boost 内部失败仍回 HTTP 200，配额 consumed 但兴趣未强化。S9 提交信息声称"6 findings 全修"，实际该根因未动。**S11 的 boost 节流直接建在这层上**（worker 失败回滚 `lastBoostAt` 键于 exitCode），exit 恒 0 → 配额照扣。待 S12 前修复（worker 按 `interestReinforced` 标志决定 exit code）。
- **S10 最严重项未修**（`77-s10-web-push-channels.md` Standards 硬违规 #1）：`schema.ts:124` VAPID `privateKey` 仍明文存 SQLite——违反「无明文 secrets 落盘」红线。待修（至少文件权限保护或信封加密）。

## 汇总

| 轴 | 硬违规 | 判断题 | 最严重 |
|---|---|---|---|
| Standards | 3（全修） | 2 | 预算计数日期键错位（UTC+8 每日 0-8 点可绕过上限） |
| Spec | 0 硬缺失 | 0 实现有误 + 1 设计判断 | 无 |

S11 四条验收准则全部命中，双轴 6 findings（P1×1、P2×2、P3×3）全部修复并复测：CP 127/127、agent 397/397、typecheck 0；时区无关性用 TZ=UTC / Etc/GMT-14 / 默认三态验证 push 测试全绿。遗留两项为 S9/S10 已标未修的跨切片问题，S11 未引入新违规；S9 的 boost 配额缺陷在 S11 修复计划中需先行处理。
