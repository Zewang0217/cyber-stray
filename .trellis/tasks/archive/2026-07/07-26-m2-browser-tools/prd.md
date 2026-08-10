# Module 2: 浏览器操作工具集

## 父任务

`07-26-browser-exploration-mvp`（浏览器探索模块 MVP，Issue #44）

## 目标

LLM 能通过 3 个语义级工具完整操作浏览器——导航、感知、交互。

## 需求

1. **3 个语义级 ToolDefinition**（对齐 agent-browser core skill 语义）

   | 工具名 | 用途 | CLI 映射 |
   |--------|------|---------|
   | `browse_page` | 导航到 URL 并提取内容 | `open <url>` + `read` |
   | `browse_snapshot` | 获取页面可交互元素结构 | `snapshot -i` / `screenshot --annotate` |
   | `browse_act` | 执行交互操作 | `click`/`fill`/`type`/`press`/`scroll`/`find`/`wait`/`back`/`tab` |

2. **browse_act 的 action 枚举**：`click`、`fill`、`type`、`press`、`scroll`、`find_click`、`find_fill`、`wait`、`back`、`tab_new`、`tab_switch`、`tab_close`

3. **ToolMetadata.category** 新增 `'browser'`
   - 同步更新 `tool-prompt.ts` 中的 `CATEGORY_NAMES` 和 `CATEGORY_ORDER`

4. **ToolContext** 新增 `browserContext?: BrowserContext`

5. **注册**到 `auto-register.ts`

6. **每个工具的单元测试**

## 验收标准

- [ ] LLM 能通过 `browse_page` 打开 URL 并获取内容
- [ ] LLM 能通过 `browse_snapshot` 获取页面结构
- [ ] LLM 能通过 `browse_act` 执行 click/fill/scroll 等操作
- [ ] 工具在 `tool-prompt.ts` 中正确分类显示
- [ ] 单元测试通过

## 依赖

- **Module 1**（BrowserExecutor）必须先完成
