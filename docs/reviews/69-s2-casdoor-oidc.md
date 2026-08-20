# Review · #69 · S2 Casdoor OIDC 登录 + 首登自动建租户

> 两轴审查 · `review` skill（本会话第二轮，口头审查，事后补文档）
> 基线 `e4564cb` (S1) → `7066f9f` (S2) · 单提交 · 25 文件 +1568 / −277
> 日期 2026-08-16

## 基线

| | |
|---|---|
| Fixed point | `e4564cb` (S1) |
| Target | `7066f9f` (S2) |
| Commit | `feat(control-plane): S2 Casdoor OIDC 登录 + 首登自动建租户（#69)` |
| Scope | 25 文件 +1568 / −277（control-plane 全新包 21 文件 + web 3 + 根配置） |
| Spec | [issue #69](https://github.com/Zewang0217/cyber-stray/issues/69) |

## Standards

**0 硬违规 / 4 判断题。**

通过项：

- **安全硬规矩**（CONTEXT.md）：`request-tenant.ts` 只从 session cookie JWT 读 `tenantId`，注释明确"绝不读 `x-tenant-*` header"，且有专门测试验证伪造 header 不能提权——教科书级实现 ✓
- **禁兜底**（guides/index.md）：`tenant.ts` readRegistry `ENOENT`→合法空注册表、损坏 JSON→抛错；`session.ts` `verifySession` catch→null 是文档化布尔契约（调用方 `/me` 按 401 处理），非掩盖 ✓
- **DB 红线**：`state-store.ts` 纯内存 Map，无 SQL 建表/migration/seed → 不触发"DB 改动须征得同意" ✓
- **最小变更**：web 三文件（next.config rewrites / proxy 登录墙 / Sidebar 登出按钮）均在 S2 鉴权范围内 ✓

判断题：

1. `config.ts` / `next.config.ts`：魔法值散落三处未抽常量——`8787`、`localhost:3000`、`localhost:8000`。**唯一字面违反 guides「无魔法值」红线**。
2. `oidc.ts` `handleCallback` ~48-50 行（建议 ≤80，合规）。
3. `index.ts:12` 启动 banner `console.log`——非调试遗留，属合理运行日志。
4. `pnpm-lock.yaml` `supports-color` peer 移除 churn 与 S2 无关（最小变更噪音）。

## Spec

**0 硬缺失 / 1 实现有误 / 0 超范围。** 五条验收准则功能上全覆盖且有测试。

- ✅ 未登录跳转 Casdoor 登录——`web/proxy.ts` 登录墙 + auth 路由 redirect
- ✅ 首登自动建租户——`tenant.ts` `getOrCreateTenant` 建 `data/tenants/<sub>/` + 注册表
- ✅ 服务端从 JWT claim 取租户、忽略 `x-tenant-*`——`request-tenant.ts`
- ✅ 登出清理 session——`auth.ts` logout `deleteCookie`
- ✅ Casdoor 自托管部署——`deploy/`（systemd unit + setup-casdoor.sh + SQLite + create-app.sh）

实现有误：

1. `oidc.ts`：spec 核心要求"**JWT org claim 携带租户 id**"——实现把租户键**硬编码为 Casdoor `sub`**，`oidc.ts` 从不读取 org claim。功能上能跑，但偏离 spec 设计的 claim 语义，后续多宠物/多组织时会撞墙。**最严重项**。

轻微项：`auth.ts` 登出仅 `deleteCookie`，未调 Casdoor end-session 做 SSO 登出——spec 只说"登出清理 session"，字面满足。

## 汇总

| 轴 | 硬违规 | 判断题 | 最严重 |
|---|---|---|---|
| Standards | 0 | 4 | 魔法值散落三处未抽常量（无魔法值红线） |
| Spec | 0 硬缺失 | 1 实现有误 | 租户键硬编码 `sub` 而非 spec 要求的 JWT org claim |

两轴指向**不同问题**：Standards 痛点是魔法值卫生；Spec 痛点是 claim 语义偏离。后者对当前单租户能跑无影响，但 spec 原文"JWT org claim 携带租户 id"是 SaaS 多租户解析的设计契约，建议在 S3 前对齐。
