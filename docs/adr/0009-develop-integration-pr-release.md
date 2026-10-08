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

## 2026-10-08：长期分支保留提交历史

合并方式以根 AGENTS.md 的 Git 规则为准：短期功能 PR 进入 develop 时 squash；develop 发布到 main 时普通 merge commit。main 的分支规则仅允许 merge，取消与之冲突的线性历史要求，保留 PR、审查、禁止强推和禁止删分支等保护。

Squash 把 develop 上的 A、B 压成 main 上的新提交 S。即使文件内容相同，main 的祖先中仍没有 A、B，后续 PR 就可能继续列出它们。此前的 `-s ours` 反向收口只让 main 的提交成为 develop 的祖先，没有让 develop 的原始提交成为 main 的祖先，因而不能解决重复列出历史的问题。提交正文自动拼接历史消息是另一项设置，已改为 PR 标题和描述。

普通 merge 让本次发布的 develop 提交直接成为 main 的祖先，后续发布能正确识别已合并内容。完整历史会保留在 main；查看每次发布可用 `git log --first-parent origin/main`。功能分支仍用 squash，保留一个 PR 一个逻辑单元的可读历史。

迁移不改写既有 main / develop 历史。首次改用普通 merge 的发布 PR 仍可能列出此前被 squash 的旧提交，这是一次性连接历史，不表示重复应用旧代码；合并后，新发布只列出尚未进入 main 的提交。发布后的祖先关系与文件差异按 AGENTS.md 校验。仅新增发布 merge commit 时不强制反向收口；release 分支或 main 的独有改动经普通 merge PR 同步回 develop。

参考：[GitHub 合并方式与长期分支 squash 的限制](https://docs.github.com/en/pull-requests/reference/pull-request-merges)。
