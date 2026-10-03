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
| #280 / PR #283（R1） | 分层骨架 + lint 棘轮门禁 + feedback.ts 迁入（330→102 行） | ✅ 已合入 rebuild-dev（待验收） |
| #284 / PR #285（R2） | pets.ts 迁入（512→310 行）+ 兴趣图谱契约下沉 shared（跨包镜像清零） | ✅ 已合入 rebuild-dev（待验收） |
| #286 / PR #287（R3） | data.ts（327→101）+ admin.ts（380→216）迁入 + Shannon 熵下沉 shared（跨包公式镜像清零） | ✅ 已合入 rebuild-dev（待验收） |
| #288 / PR #289（R4a） | requireTenant 中间件 + footprint/diary/events/channels/pet-assets 迁入（auth 核实免迁移） | ✅ 已合入 rebuild-dev（待验收） |
| #290（R4b） | petgen/push/plan/evolution/meme/dream 迁入 + **门禁全目录化（收官）** | ✅ 已合入（随 rebuild-dev 回流 develop） |
| 收官批（2026-09） | 跨包契约镜像清零：六契约下沉 shared（SSE / cookie / 作息 / petgen / Agent 状态 / 推送记录），web 删五处镜像并修两处已发生漂移；pet-sheet.py 迁仓库根 `scripts/`（Dockerfile.app 补 COPY——此前生产镜像缺该脚本）；CP 根文件归层（`auth/` 新增竖切，tenant / usage / app-config / logger / catchphrase-history 归 `infra/`，pricing 归 `domain/`） | ✅ 已合入 rebuild-dev（待验收） |
| 后续（未立票） | agent 侧 `speak.ts`：先 characterization test 再拆 PushGate / ChannelSender；web `StreetCorner` 抽 `useStreetPerformance`（配合测试票 #260/#261）；config.ts 全局租户上下文只加 lint 约束、待 core 有测试缝再动结构 | 排队 |

**收官状态（R4b）**：`routes/` 16 个文件全部只剩鉴权 + 校验 + HTTP 映射；
`requireTenant` 收敛了各 route 复制的租户校验（pet-assets 因 404 语义特例保留自定义、
evolution 沿用历史弱校验——是否收紧待持机人裁决）；eslint 门禁翻成整个
`src/routes/**`（测试文件豁免）——接口层直接 import db/fs/child_process 或使用
fetch 从此机械性红。重构批次数次验收后整批 PR 回 develop。

## 机械门禁（棘轮，只收紧不放松）

`packages/control-plane/eslint.config.mjs`：`src/routes/**` 全目录圈禁
`no-restricted-imports`（`**/db/**`、`node:fs`、`node:child_process`）+ `no-restricted-globals`（`fetch`）；
测试文件豁免（fixture 播种合法使用 db）。

- R1-R4 已逐文件圈禁并全部干净，规则已翻成整个 routes 目录（测试豁免）——只收紧不放松。
- 验收 grep 统一用 `from ['\"][^']*/db/`（要求 `/db/` 带斜杠——不带会误中 "fee**db**ack"）。

## 每票的硬约定

1. **行为不变**：route 工厂签名保持 → 对应测试文件零改动，是「语义零变化」的自证。
2. **注释清算**：触达文件按全局注释规范执行——会话代号/评审记号（S 编号、评审 B-M2、Phase N 等）删除，why 保留，改动历史归 git commit。
3. **验收材料**：PR 正文自带证据——全量测试、typecheck/lint、门禁自证（注入违规 import 必红）、grep 零命中。
4. **单一真相源优先**：跨包契约（schema/常量/公式）下沉 `packages/shared`，禁止镜像 + 注释同步。
