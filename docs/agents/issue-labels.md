# Issue 标签规范

> 本仓库 GitHub Issues 的标签体系与流转规则。`gh` 操作方式见 [issue-tracker.md](issue-tracker.md)；五角色 triage 标签的映射见 [triage-labels.md](triage-labels.md)。

## 核心模型：标签是三个正交维度

一张 issue 的标签不是一堆平级关键词，而是回答三个独立的问题。打标时每个维度至多一个主值：

| 维度 | 回答的问题 | 标签 |
|---|---|---|
| **类型** | 这是什么性质的票 | `bug` / `enhancement` / `chore` / `documentation` |
| **形态**（可叠加） | 这张票的产出物是什么 | `design`（产出方案，不产代码）/ `discussion`（产出决策）/ `epic`（父票/追踪票） |
| **triage 状态** | 下一步谁做什么 | `needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix` |

另有三个辅助维度：**验收**（`待验收`，见下文专节）、**优先级**（`高优先级` / `重要` / `低优先级`，按需）、**主题**（`saas`、`wayfinder:*`）。

## 类型标签（与 Conventional Commits 对齐）

| 标签 | 用途 | 对应标题前缀 |
|---|---|---|
| `bug` | 现有行为缺陷。功能 bug 与 UI bug 共用，UI 不另设标签 | `bug:` / `[bug]` |
| `enhancement` | 新功能或对现有功能的增强 | `feat:` / `UX:`（改进项） |
| `chore` | 杂务、质量收尾、运维执行，不改业务行为 | `chore:` / `[chore]` |
| `documentation` | 文档改进 | `docs:` |

形态标签叠加规则：

- `design`：设计提案 / RFC / IA 决策票，产出是方案而非代码（如"桌面布局设计票"）。可与 `enhancement` 并存（增强票但实现前先要方案）。
- `discussion`：需讨论拍板的议题，不直接进实施（如 `[discussion]`）。
- `epic`：父票 / PRD / 追踪票，靠子 issue 推进（如 `[PRD]` / `[tracking]`）。

## triage 状态机

| 标签 | 含义 |
|---|---|
| `needs-triage` | 新票默认。待分诊：判断类型、补验收标准、定 ready 状态 |
| `needs-info` | 缺信息，等报告人补充 |
| `ready-for-agent` | 规格完整，agent 可直接领取实施 |
| `ready-for-human` | 需人工执行——生产服务器操作、需持机人环境/权限的事 |
| `wontfix` | 不处理 |

**标签即状态，状态变了必须换标签**（这是本规范最常被违反的一条）：

- 实施 PR 合并后，`ready-for-agent` 必须摘掉。有验收项 → 打 `待验收`；无验收项 → 直接关闭。
- 一张票同时挂 `ready-for-agent` 和 `待验收` 是矛盾态，出现即说明状态没流转。
- `ready-for-human` 用于"这件事只有人能做"（如在生产服务器跑迁移 CLI），不是"等人工验收"的替身。

## 验收生命周期：`待验收`

定义：**实现或修复已合入（PR merged）或已部署生产，但 issue 内的验收标准（Acceptance criteria / 验收 checklist）尚未经持机人确认。**

- **何时打**：实施会话结束、PR 合并时。判断标准是"票内没有剩余开发项，只剩验收动作"。
  - 部分实现不算——还有明确剩余开发项的票（如修了一半、注释里列着 TODO 项）不打 `待验收`。
- **谁来验收**：持机人。人工实测、数据回放、生产观察都算。agent 的职责是把验收材料备好（可执行的命令、核对的数据路径、预期现象），写在 issue 评论里。
- **何时摘**：
  - 验收通过 → 关闭 issue，评论留验收证据（做了什么操作、看到什么结果）。
  - 验收发现问题 → 摘掉 `待验收`，视问题性质回 `ready-for-agent` 或 `needs-info`，评论写明发现的问题；能说清的直接在评论开新验收 checklist。
- **与父票的关系**：父票（`epic`）自身不打 `待验收`，除非它的关闭条件就等于"全部子项验收完"。根因跟踪票（如 #147）若代码修复已部署、只剩验收，可打。

## 标题前缀 ↔ 标签对照（建票时双写）

标题前缀是给人扫一眼的，标签是给过滤和 agent 用的，建票时两个都写：

| 标题前缀 | 必打标签 |
|---|---|
| `bug:` / `[bug]` | `bug` + `needs-triage` |
| `feat:` | `enhancement` + `needs-triage` |
| `UX:` / `IA:` | 视内容：改进项 → `enhancement`；纯决策 → `design` + `discussion` |
| `chore:` / `[chore]` | `chore` + `needs-triage` |
| `[PRD]` / `[tracking]` | `epic` |
| `[slice]` | `enhancement` + `ready-for-agent`（写清 Acceptance criteria 后） |
| `[discussion]` | `discussion` |

## 存量说明

- `测试` 标签的语义是**测试/QA 文档主题**（历史上只用于 #110 的验收 runbook），不是验收状态。验收状态一律用 `待验收`。
- 标签按需惰性创建（`gh label create`），新类型先在本文件登记再使用。
- 2026-09-07 已对 27 个 open issues 补齐类型标签并清理矛盾态（#151/#152 摘 `ready-for-agent`、打 `待验收`）。
