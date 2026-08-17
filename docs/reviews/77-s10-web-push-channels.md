# Review · #77 · S10 Web Push 系统推送 + 每租户通道绑定

> 两轴审查 · `review` skill
> 基线 `7995ad3` (S9) → `6cf2837` (S10) · 单提交 · 20 文件 +1914 / −20
> 日期 2026-08-16

## 基线

| | |
|---|---|
| Fixed point | `7995ad3` (S9) |
| Target | `6cf2837` (S10) |
| Commit | `feat: S10 Web Push 系统推送 + 每租户通道绑定（#77)` |
| Scope | 20 文件 +1914 / −20（跨 control-plane + web 两层） |
| Spec | [issue #77](https://github.com/Zewang0217/cyber-stray/issues/77) |

## Standards

**3 硬违规 / 4 判断题。** 硬违规最多的一片。

通过项：

- **安全硬规矩**（CONTEXT.md）：租户只从 session JWT 取，`x-tenant-*` 忽略；推送订阅绑定验证租户；DELETE 限本租户（`push.test.ts` 越权 DELETE→404）；飞书 webhook 走 S4 `openTenantSecrets` 信封加密存储（`channels.test.ts` 加密存储可回读 + GET 不回显凭证）✓
- **DB 改动**（guides/index.md）：migration 0004 加 `push_subscriptions`（tenant FK cascade + endpoint unique）+ `vapid_keys` 表，spec #77 授权 ✓
- **飞书不破坏**（CONTEXT.md「保留飞书/TG 不破坏既有契约」）：`channels.ts` DELETE 仅删 secret 不改 agent 推送逻辑；`worker-runner.ts:33` 新增 `feishu_webhook→feishuWebhook` 解密注入 `AgentSecrets`，agent `speak()` 消费既有字段 ✓
- **web 只读契约**：`useWebPush`/`useChannels`/settings 纯消费 API；`sw.js` 仅 push/notificationclick 事件，无数据写入 ✓
- **信封加密接入**：`worker-runner` 解密注入飞书凭证符合 S4 架构 ✓

硬违规：

1. **`schema.ts:121` VAPID `privateKey` 明文存 SQLite**（单例行 `id=1` 跨租户共享签名私钥）——违反「无明文 secrets 落盘」安全红线。虽非 per-tenant DEK 包裹的 secret，但仍是 ECDSA 签名私钥，应至少文件权限保护或信封加密。**最严重项**。
2. **`push-gateway.ts` `dispatch()` ~75 行 + 5 层嵌套**——违反 guides/index.md「方法≤50 行 / 缩进≤3 层」。
3. **`push.ts` subscribe handler 4-5 层嵌套**——违反 guides/index.md「缩进≤3 层」。

判断题：

1. `push-gateway.ts:83` JSON 坏行 `catch continue` 吞错（单条坏行跳过，非整体掩盖，可接受但临界）。
2. `push-gateway.ts` `latestPushedSpeak` 5 层嵌套（同硬违规 #2 范围）。
3. `console.*` 均为运行日志（`bus.ts:54`/`push-gateway.ts:108/169`/`worker-runner.ts:67/137`）。
4. 魔法文案/邮箱地址字面量未抽常量。

## Spec

**0 硬缺失 / 2 实现有误 / 1 设计疑点。** 三条验收准则功能上全部达成。

验收对照：
- ✅ App 关闭时收到 Web Push 通知——`web/public/sw.js` service worker `push` 事件展示系统级通知 + `notificationclick` 聚焦/导航；`useWebPush` 注册 SW + 请求权限 + POST subscribe。
- ✅ 推送订阅按租户管理、只发给该租户——`push.ts` 订阅绑 session tenant；`push-gateway.ts` 按 `tenantId` 过滤订阅；`push.test.ts` 越权 DELETE→404；跨租户隔离无泄漏。
- ✅ 飞书绑定作为可选通道可配置、不破坏既有契约——`channels.ts` GET/PUT/DELETE 飞书 webhook；`worker-runner` 注入解密凭证；agent `speak()` 消费既有字段。

实现有误：

1. **spec「推送网关读解密后的每租户凭证（S4）」未在 gateway 落地**（最严重）：`push-gateway.ts` 只做 Web Push，飞书投递绕开它走 `worker-runner` 注入 + agent `speak()`。功能等价但**架构偏离 spec 描述的统一网关**——spec 意图是推送网关统一读解密凭证，实现把飞书拆回了 agent 侧。
2. VAPID private key 明文落盘（同 Standards 硬违规 #1）——spec 虽未明说 VAPID 加密，但 CONTEXT.md「无明文 secrets 落盘」是硬规矩。

设计疑点：

- 已绑飞书租户同一 content 会双通道重复投递（Web Push + 飞书）——缺判定测试。可能是有意（多通道冗余），但 spec 未说明。

测试覆盖：`push-gateway.test.ts`（租户隔离/lastNotifiedAt 去重/404·410 清理/非成功事件不触发）、`push.test.ts`（vapid-key 稳定/endpoint 幂等/换租户归属转移/越权 DELETE 404/参数校验）、`channels.test.ts`（加密存储可回读/GET 不回显凭证/解绑/https 校验/401）——良好。

## 汇总

| 轴 | 硬违规 | 判断题 | 最严重 |
|---|---|---|---|
| Standards | **3** | 4 | VAPID privateKey 明文存 SQLite（无明文 secrets 落盘红线） |
| Spec | 0 硬缺失 | 2 实现有误 + 1 疑点 | 推送网关未统一读 S4 解密凭证（架构偏离 spec 描述） |

两轴部分重叠：VAPID 私钥明文既是 Standards 硬违规（无明文落盘）也是 Spec 实现有误（spec 意图推送网关统一管凭证）。修复优先级：①VAPID 私钥至少文件权限保护或信封加密；②`push-gateway.ts` `dispatch()` 拆分降层；③评估飞书投递是否应收归推送网关统一管（架构对齐 spec）。
