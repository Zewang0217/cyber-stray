# Review · #70 · S3 控制面数据模型（SQLite + Drizzle）

> 两轴审查 · `review` skill
> 基线 `7066f9f` (S2) → `01216c0` (S3) · 单提交 · 15 文件 +1583 / −97
> 日期 2026-08-16

## 基线

| | |
|---|---|
| Fixed point | `7066f9f` (S2) |
| Target | `01216c0` (S3) |
| Commit | `feat(control-plane): S3 SQLite + Drizzle 数据模型（#70)` |
| Scope | 15 文件 +1583 / −97 |
| Spec | [issue #70](https://github.com/Zewang0217/cyber-stray/issues/70) |

## Standards

**0 硬违规 / 4 判断题。**

核心红线全守住：

- **DB 红线**（guides/index.md「DB 改动须先征得同意」）：S3 spec #70 本身即建表许可，schema.ts 建 5 表在授权范围内，无 seed、无超 spec 表 → 不违规。
- **禁兜底**（guides/index.md）：`db/client.ts` 双驱动懒加载单例无降级；`db/migrate.ts` Postgres 路径直接抛错（不兜底）；`tenant.ts` 从 JSON 注册表迁 SQLite 事务 + `onConflictDoNothing` 幂等 + 归档 `.bak`，损坏 JSON 抛错 → 无违规。
- **不迁 Postgres 约束**（CONTEXT.md）：schema 无 memory/history/interest 表——编排状态进 SQLite，记忆仍 markdown，符合 spec「记忆仍在 markdown 不迁移」。
- **安全硬规矩**（CONTEXT.md）：`tenant.ts` 迁移后仍只从 session JWT 取 tenant，未引入信任客户端 header 的路径。
- **方法/缩进/文档注释**：`db/client.ts`(69行)、`tenant.ts`、`db/migrate.ts` 均 ≤50 行 / ≤3 层；schema 导出表有 JSDoc 注释。

判断题：

1. `db/schema.ts`：`boredom` 默认 30 / `energy` 默认 80 / `amountCents` 0 等字面量未抽常量（spec 未给具体值，判断题）。
2. `index.ts:69` `console.log` 启动 banner（同 S2 模式，非调试遗留）。
3. `auth.ts:47` `console.error` OIDC 回调失败日志（合理运行日志）。
4. `tenant.ts` 运行时注册迁移 + legacy JSON 归档——可辩护为迁 SQLite 必要改动，但严格说是运行时副作用。

**最严重（判断题）**：schema 魔法值未抽常量——量级最低，不影响正确性。

## Spec

**0 硬缺失 / 2 实现有误 / 1 轻微超范围。** 四条验收准则基本达成。

验收对照：

- ✅ 表结构覆盖租户/宠物/用户关系/账单预留——`schema.ts` 五表齐全（`tenants` / `userTenants` / `pets` / `billing` / `tenantSecrets`）。
- ✅ 宠物表含调度所需字段——`pets` 有 `lastRunAt` / `boredom` / `energy` / `plan`，`db.test.ts` 有覆盖。
- ✅ 编排状态在此层、记忆不迁移——schema 无 memory/history/interest 表；legacy JSON 注册表归档 `.bak`；markdown 数据目录保留。
- ◑ ORM 迁移可用、连接串可切 Postgres——SQLite 迁移可用（幂等）；查询层方言无关可切 pg 驱动；但 `migrate.ts` 对 Postgres **直接抛错**，需按 pg dialect 重生成迁移——spec 说的「只改连接串即可」仅到查询层，迁移层未做到。

实现有误：

1. **`user_tenants` 复合主键声明但迁移未落库**（最严重）：`schema.ts` 声明 `userTenantsPk: primaryKey({ columns: [userId, tenantId] })`，但 `drizzle/0000_flimsy_echo.sql` 与 `meta/0000_snapshot.json` 的 `compositePrimaryKeys` 均为空——约束形同虚设。当前靠 `onConflictDoNothing` + `tenants` 主键短路掩盖，但同一 user 重复绑同一 tenant 的约束实际不在 DB 层。需重新生成迁移让复合主键落库。
2. `tenants.name` `NOT NULL` 但 OIDC `user.name` 可选——`auth.ts` 传 `user.name` 建租户，Casdoor 返回无 name 时会 NOT NULL 违约（边界，当前单用户首登有 name）。

轻微超范围：

- `tenant.ts` 运行时注册迁移 + legacy JSON 归档——spec 未明示迁移运行时行为，但为从 S2 JSON 注册表迁 SQLite 的必要改动，可辩护。

**最严重**：`user_tenants` 复合主键迁移未落库——DB 层约束缺失，被应用层幂等掩盖，属潜在数据完整性风险。

## 汇总

| 轴 | 硬违规 | 判断题 | 最严重 |
|---|---|---|---|
| Standards | 0 | 4 | schema 魔法值未抽常量（判断题） |
| Spec | 0 硬缺失 | 2 实现有误 + 1 超范围 | `user_tenants` 复合主键迁移未落库 |

两轴指向不同：Standards 痛点是魔法值卫生；Spec 痛点是迁移与 schema 失同步导致 DB 约束缺失。后者是数据完整性风险，建议在 S4 前重新生成迁移让复合主键落库。
