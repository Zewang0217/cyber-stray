# Review · #73 · S6 租户数据路由 + Web API 鉴权

> 两轴审查 · `review` skill
> 基线 `47ad4ee` (S5) → `ed479b4` (S6) · 单提交 · 13 文件 +498 / −318
> 日期 2026-08-16

## 基线

| | |
|---|---|
| Fixed point | `47ad4ee` (S5) |
| Target | `ed479b4` (S6) |
| Commit | `feat: S6 租户数据路由 + Web API 鉴权（#73)` |
| Scope | 13 文件 +498 / −318 |
| Spec | [issue #73](https://github.com/Zewang0217/cyber-stray/issues/73) |

## Standards

**0 硬违规 / 4 判断题。**

通过项：

- **安全硬规矩**（CONTEXT.md）：`routes/data.ts` 每请求经 `scopedTenant` 从 session cookie JWT 取 `tenantId`（忽略 `x-tenant-*` header），查 `user_tenants` 关系行校验（缺失→403），`TENANT_ID_RE` 防路径注入，拼 `tenants/<tenantId>/` 目录只读 ✓
- **web 只读契约**（agent/core/index.md + CONTEXT.md）：data.ts 4 端点全 GET，全程零写入；`url`/`mood` 仅透传不派生 ✓
- **清理彻底**：web 侧删 5 文件（4 API route + `lib/data-path.ts`），grep 确认无残留引用 ✓
- **最小变更**：`next.config.ts` +4 rewrite、`page.tsx` +27 拆 error/empty 空态、`useAgentState` +5 处理 `data:null`、`proxy.ts` +6 注释——均为迁移必要改动 ✓
- **测试完备**：`data.test.ts` 179 行覆盖 401/403/租户隔离/伪造 `x-tenant`/损坏→500/缺失→200 空态/只读快照断言 ✓

判断题：

1. `data.ts:182-186` `/history` 单文件 `catch` 静默吞非 ENOENT 读错误——与 `data.ts` 自身 `isEnoent` 注释「非 ENOENT 必须显式抛」自相矛盾，轻度降级。**最接近违规项**。
2. `data.ts:143/176` 内联魔法数。
3. `/interests/history` 与 `/history` 嵌套达 4 层（建议 ≤4 层，合规但已达上限）。
4. `console.error` 读失败日志（合理运行日志）。

**最严重**：`/history` catch 吞非 ENOENT 错误——与文件内注释自相矛盾，属轻度降级（旧 web 路由逐字迁移带来）。

## Spec

**0 硬缺失 / 0 实现有误 / 2 低危偏差。** 三条验收准则全部达成。

验收对照：
- ✅ 现有 API 按租户路由且鉴权——4 端点（`/state`/`/interests`/`/interests/history`/`/history`）迁到 `data.ts`，经 `scopedTenant` 做 401/403 + 租户目录路由；web 旧路由删净，`next.config` 补 rewrites。
- ✅ 未鉴权/跨租户访问被拒——401（无 session）/403（claim 与 user_tenants 不匹配）；伪造 `x-tenant-*` 无效（测试覆盖）。
- ✅ 只读契约不破坏——全程零写入、`url`/`mood` 仅透传、测试快照断言只读。

低危偏差：

1. **跨租户 403 为防御性死路径**（最严重）：登录恒设 `tenantId==sub`（`getOrCreateTenant` 用 Casdoor sub 作 tenantId），每用户独占 `tenants/<sub>/` 目录——隔离靠**构造成立**而非可实际触发的活动校验。正常双真实用户流程下 403 分支不可达。功能上隔离有效，但 403 是过期/伪造 claim 的兜底，非多租户并发场景的真实隔离。
2. `normalizeRecord` 透传 `gateReasons`/`messageId`/`matchedTopics` 超出旧 web 路由 shape（轻微超范围，可辩护为展示增强）。

**最严重**：跨租户隔离靠 `tenantId==sub` 构造成立——当前单租户单用户模式下无实际风险，但 spec 意图的"跨租户访问被拒"在真实多用户场景下未被活动校验路径覆盖。

## 汇总

| 轴 | 硬违规 | 判断题 | 最严重 |
|---|---|---|---|
| Standards | 0 | 4 | `/history` catch 吞非 ENOENT 错误（与文件内注释矛盾） |
| Spec | 0 硬缺失 | 2 低危偏差 | 跨租户隔离靠 `tenantId==sub` 构造成立，403 为不可达死路径 |

两轴指向不同：Standards 痛点是 `/history` 错误处理与注释矛盾；Spec 痛点是隔离的构造性 vs 活动性。后者在当前单用户模式无风险，但 S7+ 多用户旅程展开后需留意——若未来 `tenantId` 不再等于 `sub`（如组织邀请、多宠物），403 路径才真正被激活。
