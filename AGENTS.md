# cyber-stray AGENTS.md

> 本仓库的 agent 行为入口。

**项目本质**：自进化赛博宠物——被自己不断进化的好奇心驱动去探索和学习，并主动推送主人会感兴趣的内容。宠物是产品本体：活着的、有脾气的、看得见的，不是信息流的隐喻层。

**主轴（不可妥协）**：兴趣会进化 + 能主动推主人感兴趣的内容。推送渠道 / 仪表盘 / 搜索源都可以失败或替换；冲突时一切 tradeoff 保主轴。

## 规范真相源：`.trellis/spec/`

规范只写在那里，本文件不复述。动手前按改动范围读：

| 改动范围                                     | 先读                                                                                                                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent`                             | `.trellis/spec/agent/core/`——`index.md` 架构 + 开发前 checklist、`conventions.md` 硬约定全文                                                                                                             |
| `packages/web` UI / 视觉                     | `.trellis/spec/web/frontend/`（**只读契约**）+ `design-v3/DESIGN.md`（像素街区世界宪法；组件 / 动效 / 依赖见同目录另三份文档）                                                                           |
| `packages/control-plane` / `packages/shared` | 该层暂无 `.trellis/spec/`：分层（`routes → services → domain → infra`）与 lint 门禁、跨包契约下沉 `shared` 的硬约定见 `docs/refactor/README.md`；多租户 / 鉴权 / 计费决策见根 `CONTEXT.md` + `docs/adr/` |
| 跨包、发布、分支                             | `.trellis/spec/guides/`——核心价值、架构决策、行为红线、Git 与分支流程（ADR-0009）                                                                                                                        |
| 领域词汇 / 已锁定决策                        | 根 `CONTEXT.md` + `CONTEXT-MAP.md` + `docs/adr/`                                                                                                                                                         |

## 硬约定（写 agent 代码必守）

- **无兜底**：失败就抛明确异常、让调用方看见真实错误；不用默认值 / 降级 / 推断掩盖。
- **路径**：数据文件走 `getDataPath()`，不写模块级路径常量——import 时求值会把测试写穿生产数据。
- **异步**：耗时 I/O 用 `execFile` / `spawn` + `AbortController`；`execSync` 会卡死事件循环，心跳 / TUI / 反思调度全停摆。
- **grounding**：反思洞察必引 ≥1 条真实 `sourceIds`，无源整条丢弃，不得绕过。
- **记忆**：索引复用 `MemoryIndex`，不另建并行索引；provenance 标 `untrusted:web` / `self:reflection` / `self:action`。
- **DB 改动先征得同意**；LLM 产出用 Zod 校验。

## 工作流

1. **读 spec**：能说出本次改动涉及哪几条硬约定，再动手。
2. **先说方案**：用 1-2 句讲清怎么做，方案先出口，不是边写边改。
3. **最小变更**：只动该动的，先问能不能复用既有实现（`.trellis/spec/guides/code-reuse-thinking-guide.md`）。
4. **验证**：改动范围的 `pnpm test` / `lint` / `typecheck` 通过；UI 改动在浏览器实测；push 前确认 diff 无 `console.log` / TODO / 敏感信息。

## Git

只在 `develop` 开发，PR 目标 `develop`（ADR-0009：`main` 只接受 develop 的发布 PR）。提交信息、分支命名、开发前拉取的细则见 `.trellis/spec/guides/index.md` §Git。

## Agent skills

- **Issue tracker**：GitHub Issues，用 `gh` 操作；外部贡献者的 PR 也进同一 triage 队列 → `docs/agents/issue-tracker.md`
- **Issue 标签**：三维度（类型 / 形态 / triage）+ `待验收` 生命周期，PR 合并后摘 `ready-for-agent` → `docs/agents/issue-labels.md`、`docs/agents/triage-labels.md`
- **Domain docs**：`CONTEXT-MAP.md` 定位各 context 的 `CONTEXT.md`，输出里的领域概念用词以词表为准 → `docs/agents/domain.md`
