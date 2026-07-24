# Agent 硬约定

这些是 review / 写代码时必须守的硬规则，不是建议。

## 工具

- **工厂模式**：每个工具导出 `ToolDefinition`（`{ metadata, createTool(ctx) }`），`createTool` 内用 AI SDK `tool()` 包装；在 `auto-register.ts` 静态数组注册。
- **语义级粒度**：一个工具 = 一个完整动作（如 `search_web`、`read_page`），**不是**原子操作。新增浏览器类工具同样保持高层语义，内部组合底层命令。
- **新增 category**：给 `ToolMetadata.category` 加字面量后，**必须同步**改 `tool-prompt.ts` 的 `CATEGORY_NAMES` + `CATEGORY_ORDER` 两处，否则新工具被静默归入"其他"分组（建议这两处改 exhaustive check）。
- **trace**：工具 `execute` 内调 `pushWanderStep(ctx, ...)` 汇入 `ctx.wanderHistory`（现成 trace，勿另建机制）。

## 记忆

- **三写**：`MemoryStore.saveMemory` 写 Markdown（真相源）+ `INDEX.md`（人类导航）+ `.index.json`（查询）。原子写（temp+rename）。
- **索引复用**：新索引需求**复用 `MemoryIndex`**（`memory-index.ts`，已有原子写 + 崩溃自愈 + 模块单例），**不另建并行索引类**。
- **provenance**：记忆带来源标记 `untrusted:web` / `self:reflection` / `self:action`。反思只读 `provenance !== 'self:reflection'`（防自激）。
- **grounding**：反思产出的每条洞察必须引用 ≥1 条真实存在的观察 id（`sourceIds`），无源整条丢弃——这是防幻觉核心，**不得绕过**。改反思结构时勿断此链。
- **有界**：记忆接 `consolidator` / `cleanup`，不无界增长。

## 异步

- **全异步**：所有 I/O 用 `fs/promises` + Promise。
- **禁止 `execSync`**：耗时操作（浏览器 / 外部进程）用 `execFile` / `spawn` 包 Promise + `AbortController` 超时。`execSync` 会卡死事件循环——心跳、TUI 渲染、`onStepFinish`、反思调度全部停摆。

## 行为红线

- **禁止兜底**：错误就该抛明确异常，**不用默认值 / 降级 / 推断数据掩盖**。兜底比报错更危险——调用方会误以为正常，实际拿到错误结果。
- **数据库改动须先征得同意**（含 migration / seed / 建表 / 删表，本地库也不例外）。
- **最小变更**：只动该动的，匹配既有风格，不投机重构。
- **反思温度 0.4**（一致性 > 创造性）。
- **Zod 校验**：LLM 产出 / 工具入参用 Zod schema 校验，防胡编。
