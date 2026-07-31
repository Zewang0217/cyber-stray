# 修复 monorepo 迁移后的 data 目录错位与推送历史契约

## Goal

让 Web 仪表盘重新读到 agent 的真实运行数据，并让 History 页面能正确展示推送记录（含被门控拦截、仅学习未推送的内容）。

pnpm monorepo 迁移把 agent 从 `src/` 移到 `packages/agent/`、web 从 `web/` 移到 `packages/web/` 之后，两侧的数据目录解析没有同步更新：agent 写 `packages/agent/data/`，web 读 `packages/web/../data`（即 `packages/data/`，一个不存在的目录）。因此仪表盘的状态、兴趣图谱、推送历史四个接口全部落空。此外 History 页面期待的记录结构与 agent 实际写入的结构从来没有对齐过。

## Requirements

### R1 — 数据目录唯一化（`packages/agent/data/`）

- 数据目录的唯一归属是 `packages/agent/data/`，与 `.gitignore:26` 及提交 `5853f91`（"清理旧版数据文件并统一数据目录"）的既定意图一致。不引入仓库根 `data/`。
- agent 侧数据路径必须与启动时的 cwd 无关：从仓库根、从 `packages/agent/`、或从任意目录启动，读写的都是同一个 `packages/agent/data/`。
- `DATA_DIR` 环境变量仍然是最高优先级覆盖项，测试隔离依赖它。
- agent 源码中不得再有绕过统一入口的硬编码 `data/...` 相对路径。
- web 侧四个 API 路由必须解析到同一目录，并允许用同名环境变量覆盖。

### R2 — 推送历史契约对齐

- agent 写入 `data/history/speaks-*.jsonl` 的记录需包含 web 卡片渲染所需的结构化字段：标题、链接、摘要、当时心情，同时保留原有的 `content` / `type` / `pushed` / `timestamp` / `messageId`。
- 结构化字段由 agent 侧从推送内容派生，不改动 `speak` 工具暴露给 LLM 的入参 schema。
- 被推送门控拦截的内容也要写入历史（当前直接 return，完全没有留痕），并带上门控标记与评分。
- web 侧对没有结构化字段的旧记录要能降级展示，不能因为字段缺失而白屏或渲染出 `undefined`。

### R3 — History 页面区分推送状态

- 已推送、被门控拦截（仅学习）、推送失败三种状态在卡片上可区分。
- 没有链接的记录（`nonsense` 类碎碎念）不渲染外链入口。

## Constraints

- 遵循项目 CLAUDE.md：不做无意义兜底，错误应显式暴露而非用默认值掩盖。
- 不破坏现有飞书 / Telegram 推送链路、TUI、以及 web 只读轮询的契约。
- 现有 18 个 agent 测试必须继续通过；测试的文件系统隔离机制（`useTempDataDir`）不能失效。
- 不引入数据库，保持文件系统为唯一真相源。
- 不改动 ReAct 主循环的决策逻辑。

## Out of Scope

- 补 `/logs` 页面（Sidebar 有链接但页面不存在）——独立的功能缺口。
- Settings 页面的静态硬编码值改为真实配置——独立工作。
- web 端 API 鉴权——已在 PROJECT.md 中列为独立安全工作。
- README 过时内容重写——独立文档任务。

## Acceptance Criteria

- [ ] 从仓库根目录和从 `packages/agent/` 两种 cwd 启动 agent，数据都落在 `packages/agent/data/`
- [ ] `grep -rn "'data/" packages/agent/src --include=*.ts` 在非测试文件中无结果
- [ ] `pnpm dev:web` 启动后 `/api/state`、`/api/interests`、`/api/interests/history`、`/api/history` 四个接口都能读到 `packages/agent/data/` 下的真实文件
- [ ] 仪表盘首页能显示真实的无聊 / 精力 / 心情与兴趣条形图
- [ ] 一次 speak 推送后，History 页面卡片显示出标题、摘要、心情与时间，而不是空白字段
- [ ] 一次被门控拦截的 speak 在 History 中出现，并标记为"仅学习 / 未推送"
- [ ] 旧格式（仅 `content` / `type` / `pushed` / `timestamp`）的历史记录仍能正常展示
- [ ] `pnpm typecheck`、`pnpm lint`、`pnpm test` 全绿
