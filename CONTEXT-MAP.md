# CONTEXT-MAP — cyber-stray 多上下文领域语言

> 本文件是 cyber-stray 的**多上下文领域语言导航**。每个 context 对应一个包，有独立 `CONTEXT.md`（包级领域词汇）和 `docs/adr/`（包级架构决策）。
> 根 `CONTEXT.md` 记录**系统级**SaaS 共享词汇与已锁定决策（跨包通用），各包 `CONTEXT.md` 记录该包内部领域语言。
> 工程技能（`improve-codebase-architecture` / `diagnosing-bugs` / `tdd` / `grill-with-docs`）按此表找对应 `CONTEXT.md` 读。

## Contexts

| Context | CONTEXT.md | 状态 | 说明 |
|---|---|---|---|
| **system**（系统级） | [`CONTEXT.md`](./CONTEXT.md) | ✅ 已存在 | SaaS 共享词汇 + 已锁定决策（定价 / 多租户 / 鉴权 / 实时 / 反馈回路） |
| **agent** | [`packages/agent/CONTEXT.md`](./packages/agent/CONTEXT.md) | ⏳ 待 `/domain-modeling` 创建 | agent 运行时领域：ReAct 循环 / 三层记忆 / 反思 / 兴趣图谱 / 推送门控 / TUI |
| **web** | [`packages/web/CONTEXT.md`](./packages/web/CONTEXT.md) | ⏳ 待创建 | Web 仪表盘领域：只读契约 / PWA / SSE 实时 / 兴趣图谱可视化 |
| **control-plane** | [`packages/control-plane/CONTEXT.md`](./packages/control-plane/CONTEXT.md) | ⏳ 待创建 | 控制面领域：Casdoor 鉴权 / SQLite 元数据 / 调度器 + 短命 worker / 信封加密 |
| **slides** | [`packages/slides/CONTEXT.md`](./packages/slides/CONTEXT.md) | ⏳ 待创建 | Slidev 演示文稿 |

> ⏳ 状态的 `CONTEXT.md` 尚不存在。它们由 `/domain-modeling` 技能在该包的术语/决策**实际被解决时**惰性创建，不预先建空文件。

## ADR 位置

- **系统级**：[`docs/adr/`](./docs/adr/) — 跨包架构决策（现有：0005 口头禅系统）
- **包级**：`packages/<pkg>/docs/adr/` — 该包内部架构决策（按需创建）

## 如何消费

1. 跨包工作 → 读根 `CONTEXT.md` + 相关包 `CONTEXT.md`。
2. 只动一个包 → 读该包 `CONTEXT.md`（若有）+ 根 `CONTEXT.md` 的相关决策段。
3. 任何包工作前 → 查根 `docs/adr/` 与该包 `docs/adr/` 是否有相关 ADR。
4. 文件不存在 → 静默继续，不报错不建空桩（`/domain-modeling` 负责按需创建）。
