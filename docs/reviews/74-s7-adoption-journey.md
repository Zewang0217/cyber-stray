# Review · #74 · S7 伴侣端旅程——领养 + 自我介绍

> 两轴审查 · `review` skill
> 基线 `ed479b4` (S6) → `8a1be73` (S7) · 单提交 · 13 文件 +1212 / −15
> 日期 2026-08-16

## 基线

| | |
|---|---|
| Fixed point | `ed479b4` (S6) |
| Target | `8a1be73` (S7) |
| Commit | `feat: S7 伴侣端旅程——领养 + 自我介绍（#74)` |
| Scope | 13 文件 +1212 / −15 |
| Spec | [issue #74](https://github.com/Zewang0217/cyber-stray/issues/74) |

## Standards

**0 硬违规 / 6 判断题。**

通过项：

- **禁兜底**（guides/index.md）：`pets.ts:124` 仅吞 `EEXIST`（幂等，合法）；`:156` 为 400 输入校验；非 EEXIST 均抛错 ✓
- **安全硬规矩**（CONTEXT.md）：pets API 从 session JWT 取 tenant（`scopedTenantId`），请求体无租户字段（无法越权建他人租户宠物）；`user_tenants` 关系校验 + `TENANT_ID_RE` 防注入 ✓
- **web 只读契约**（CONTEXT.md + agent/core）：前端 `usePets`/`AdoptionFlow`/`PetIntro` 纯 fetch control-plane API，`interests.json` 由服务端写（`wx` 不覆盖已游荡租户），前端不直写 agent 数据 ✓
- **DB 改动**（guides/index.md）：migration 0002 仅加 `pets_tenant_unique` 唯一索引（1 租户 1 宠物，符合 CONTEXT 锁定范围），未超 spec #74；`scheduler.test` 改动是唯一索引的必要适配 ✓
- **租户上下文**（CONTEXT.md「前端状态是便捷，服务端 claim 是真相」）：前端不传/不信租户，服务端 claim 为真相 ✓

判断题：

1. `pets.ts` adopt handler ~52 行（建议 ≤80，合规）。
2. `boredom:30`/`energy:80` 内联魔数重复 DB 默认值（schema.ts 与 pets.ts 两处）。
3. 校验阈值 `32`/`12`/`24`（名字长度等）硬编码。
4. `AdoptionFlow.tsx` JSX 嵌套 5-6 层（超建议 4 层；「缩进」规则本针对控制流，展示层 JSX 临界）。
5. `createPetsRoutes` 无内联 JSDoc（文件头注释覆盖）。
6. 客户端 `SUGGESTED_INTERESTS` 与服务端默认兴趣常量重复，有漂移风险。

**最严重**：跨包默认兴趣常量重复（漂移风险）+ boredom/energy 魔数重复——均非阻断。

## Spec

**1 硬缺失 / 1 实现有误 / 0 超范围。** 四条验收准则三条达成，一条部分缺失。

验收对照：
- ✅ 无宠物用户首推前走完领养流程——`page.tsx` `pets.length===0`→`AdoptionFlow`（起名→选初始兴趣，默认 16 项可改防后悔）。
- ✅ 自我介绍 UI 首推前展示——`PetIntro.tsx` 5 行打字动画 + interests 拼接 + `onDone`。
- ✅ 领养即建宠物记录 + 数据目录——`pets.ts` insert pets 表 + 写 `tenants/<id>/interests.json` 种子（`wx` 不覆盖）。
- ◑ **AC4「登录态租户上下文注入前端」部分缺失**：只完成服务端 claim 半边，前端**无 `/api/auth/me` 调用**，无任何租户上下文注入。前端仅从 `usePets` 的 Pet 对象取 `tenantId`/`plan` 字段——但 spec 说「前端状态是便捷，服务端 claim 是真相」，前端应主动拉取 claim 注入状态，当前缺失。

**What to build 缺失**：「默认主题 + **plan 门控脚手架**」缺失——adopt 硬编码 `plan:'free'`，前端无 free/pro/byok 门控逻辑。**最严重项**——spec 明确要求 plan 门控脚手架，当前仅占位。

实现有误：

1. `page.tsx` 领养门含 `!petsError`——adopt 瞬时失败/409 会把用户踢出领养流程到错误仪表盘，且 409 边角会跳过自我介绍。失败应留在领养流程内提示重试。

测试覆盖：`pets.test.ts` 201 行（401/403、建行+种子、默认兴趣、幂等 409、种子不覆盖、参数 400、租户隔离、种子 schema 兼容）——良好。

## 汇总

| 轴 | 硬违规 | 判断题 | 最严重 |
|---|---|---|---|
| Standards | 0 | 6 | 跨包默认兴趣常量重复（漂移风险） |
| Spec | **1 硬缺失** | 1 实现有误 | AC4 前端租户上下文注入缺失 + plan 门控脚手架缺失 |

S7 的核心旅程（领养→自我介绍）功能完整且有测试，但 Spec 轴有两个真实缺口：①前端未主动拉取 `/me` 注入租户上下文（AC4 半边）；②spec「plan 门控脚手架」完全缺失（adopt 硬编码 free）。后者是 spec 明确要求项，建议在 S8 前补齐 plan 门控脚手架，否则 S11 双轨定价时没有接入点。
