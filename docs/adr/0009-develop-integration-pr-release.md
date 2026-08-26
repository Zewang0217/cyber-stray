# develop 集成、develop→main PR 即发布

分支模型：develop 是唯一集成区，所有功能/修复 PR 目标 develop；develop 上只跑质量门（typecheck / test / lint + web 构建验证），不产镜像。发布 = 人工开一个 develop→main 的 PR，merge 即触发构建镜像、推 GHCR、SSH 部署，全程无人工审批门。

## Considered Options

- **Trunk-based（PR 直接进 main）**：发布与开发节奏绑死，没有集成缓冲；且与仓库既有约定（AGENTS.md「PR 目标默认 develop」）冲突。
- **Environment 审批门**：单人团队下审批 = 自己批自己，仪式成本高于收益；develop→main 的 PR 本身已是一次显式、有记录的发布动作。
- **一键 fast-forward（workflow_dispatch）**：更省力，但发布没有记录——谁发的、带了哪些提交、一句话说明，全靠事后翻 git log。

## Consequences

- AGENTS.md 的「PR 目标默认 develop」恢复为真实约定。此前 develop 事实死亡（main 领先 develop 76 个提交，ci/deploy 都只挂 push:main）；2026-08-26 已将 main 并入 develop 完成同步。
- main 的每次合并都对应一次生产发布，develop→main PR 的描述即发布说明。
- develop 上的构建不产消费物（不出镜像），避免 GHCR 堆积无人拉的 dev 镜像。
- SQLite 迁移在控制面启动时自动执行且单向：发布新镜像前，schema 变更必须兼容「旧代码读新 schema」，否则坏版本无法简单换 tag 退回。
