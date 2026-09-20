# CP 分层重构轨（rebuild-dev 分支）

> 目的：control-plane 路由层（16 个文件约 7.3k 行）从「接口层直捅存储」收敛为
> `routes → services → domain → infra` 四层，依赖方向单向，lint 门禁棘轮式收紧。
> 分层标准的完整版在全局规范库（`~/.agents/docs/architecture/layering.md`）；本文自包含，不依赖它也可执行。

## 分支策略（不影响功能开发）

- **`rebuild-dev`**：重构轨集成分支（自 develop 切出）。所有重构 PR 以它为目标，一票一合，全程测试绿。
- **`develop`**：功能主线照旧——功能 PR 目标不变、节奏不变，与本分支零冲突（重构只动 routes/services/infra 与既有文件内部结构，不改行为契约）。
- 重构批次的回流：rebuild-dev 按里程碑（如 R1-R4 完成）整批开一个 PR 回 develop，合入前全量测试 + 持机人验收。
- 票流：每张 R 票独立分支 + PR（目标 rebuild-dev）→ 合并后摘 `ready-for-agent`、挂 `待验收` → 持机人验收通过才关票。
- stacked PR：后票基于前票分支时，前票合并后把 base 切到 rebuild-dev（GitHub 会自动重算 diff）。

## 路线图与状态

| 票 | 范围 | 状态 |
|---|---|---|
| #280 / PR #283（R1） | 分层骨架 + lint 棘轮门禁 + feedback.ts 迁入（330→102 行） | PR 待合并（base=rebuild-dev） |
| #284 / PR #285（R2） | pets.ts 迁入（512→314 行）+ 兴趣图谱契约下沉 shared（跨包镜像清零） | PR stacked 于 #283 |
| R3（未立票） | data.ts + admin.ts 迁入；Shannon 熵公式下沉 shared（第 2 处跨包镜像：data.ts 与 agent getEntropy 靠注释同步） | 待开始 |
| R4（未立票） | 其余 12 个 route 分层 + `requireTenant` 中间件收敛 13 处 `scopedTenantId` 复制；门禁扩成 `src/routes/**` | 待 R3 |
| 后续（未立票） | agent 侧 `speak.ts`：先 characterization test 再拆 PushGate / ChannelSender；web `StreetCorner` 抽 `useStreetPerformance`（配合测试票 #260/#261）；config.ts 全局租户上下文只加 lint 约束、待 core 有测试缝再动结构 | 排队 |

## 机械门禁（棘轮，只收紧不放松）

`packages/control-plane/eslint.config.mjs`：已分层 route 文件逐一圈禁
`no-restricted-imports`（`**/db/**`、`node:fs`、`node:child_process`）+ `no-restricted-globals`（`fetch`）。

- 当前圈禁：`routes/feedback.ts`（R1）、`routes/pets.ts`（R2）。
- 后续每票把各自 route 文件加入圈禁；全部干净后规则翻成整个 `src/routes/**`。
- 验收 grep 统一用 `from ['\"][^']*/db/`（要求 `/db/` 带斜杠——不带会误中 "fee**db**ack"）。

## 每票的硬约定

1. **行为不变**：route 工厂签名保持 → 对应测试文件零改动，是「语义零变化」的自证。
2. **注释清算**：触达文件按全局注释规范执行——会话代号/评审记号（S 编号、评审 B-M2、Phase N 等）删除，why 保留，改动历史归 git commit。
3. **验收材料**：PR 正文自带证据——全量测试、typecheck/lint、门禁自证（注入违规 import 必红）、grep 零命中。
4. **单一真相源优先**：跨包契约（schema/常量/公式）下沉 `packages/shared`，禁止镜像 + 注释同步。
