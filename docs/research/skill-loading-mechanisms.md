# AI 编程代理工具：Skills/Rules 加载机制调研

调研主流 AI 编程代理工具如何发现、加载、解析、注入和执行自定义指令、规则与技能。

---

## Claude Code

Claude Code 是 Anthropic 的命令行 AI 编程代理（npm：`@anthropic-ai/claude-code`），拥有最为成熟的技能生态体系。技能是一等公民，与斜杠命令统一为一体。技能系统遵循 Anthropic 发起的 [agentskills.io](https://agentskills.io/) 开放标准，并在此基础上做了专有扩展。

### 1. 技能/命令的发现机制

Claude Code 按 **六个优先级层级**（从高到低）发现技能：

| 层级 | 位置 | 作用域 |
|------|------|--------|
| **企业级** | 管理员策略下发 | 组织全局，云端同步 |
| **个人级** | `~/.claude/skills/` | 用户全局，跨项目 |
| **项目级** | `.claude/skills/` | 单项目，版本控制 |
| **插件级** | `plugins/<name>/skills/` | 随插件分发，自动发现 |
| **内置级** | 内建命令（如 `/debug`、`/code-review`） | 随 Claude Code 发布 |
| **旧版命令** | `.claude/commands/*.md`、`~/.claude/commands/*.md` | 向下兼容，自动提升为技能 |

**关键行为：**

- **父目录扫描**：不仅扫描当前工作区，还会向上扫描父目录直至文件系统根目录
- **嵌套目录扫描**：`.claude/skills/` 内的子目录会被递归扫描，查找 `SKILL.md`
- **`--add-dir` 命令行参数**：可在运行时添加额外目录
- **插件自动发现**：扫描 `.claude/plugins/` 目录下的 `plugin.json`；插件可贡献技能、子代理、钩子和 MCP 服务器
- **旧版命令向下兼容**：`.claude/commands/*.md` 中的文件会自动提升为等价的技能。`.claude/commands/deploy.md` 与 `.claude/skills/deploy/SKILL.md` 都会创建 `/deploy`，工作方式完全相同
- **实时文件监听**：技能目录被操作系统文件变更事件监控；新增/修改/删除的技能无需重启即可生效

**参考来源：**
- [Extend Claude with skills — 官方文档](https://code.claude.com/docs/en/skills)
- [Extend Claude Code — 功能总览](https://code.claude.com/docs/en/features-overview)
- [Agent SDK 中的插件](https://code.claude.com/docs/en/agent-sdk/plugins)
- [Agent SDK 中的技能](https://code.claude.com/docs/en/agent-sdk/skills)
- [自定义斜杠命令已合并入技能 — DEV Community](https://dev.to/rulestack/custom-slash-commands-in-claude-code-how-they-work-now-that-commands-are-skills-425k)

### 2. 解析与加载格式

**技能采用 YAML 前置元数据 + Markdown 正文**，遵循 agentskills.io 规范，并附加 Claude Code 专有字段：

```yaml
---
name: deploy
description: 使用标准流水线将项目部署到生产环境。
argument-hint: [environment]
model-invocation: enabled     # Claude Code 专有
context: fork                  # Claude Code 专有：inline | fork
tools: Bash, Read, Write       # Claude Code 专有：工具白名单
---
# 部署到 $1

1. 运行 `pnpm build`
2. 运行 `pnpm deploy --env=$1`
```

**agentskills.io 标准字段：**
- `name` — 唯一标识符（未填写时以目录名兜底）
- `description` — 自动补全中展示的描述；模型据此决定何时调用
- `argument-hint` — 斜杠命令补全时的参数提示
- `disable-model-invocation` — 为 true 时只能通过 `/` 手动触发
- `metadata` — 任意键值对
- `license` — SPDX 标识符
- `version` — 语义化版本号
- `homepage` — URL

**Claude Code 专有字段：**
- `model-invocation: enabled` — 明确允许模型自主调用该技能
- `context: fork` — 创建隔离的子代理执行，而非内联执行
- `tools` — 限制技能执行期间可用的工具
- `$ARGUMENTS`、`$1`、`$2` 等 — 位置参数替换（来自 `/skill-name` 后的用户输入）
- `` !`command` `` — Bash 预处理：命令输出在发送前注入 prompt
- `@path` — 文件引用：读取文件内容并注入 prompt
- `${CLAUDE_SKILL_DIR}` — 解析为技能所在目录（用于引用打包的脚本/资源）

**两阶段解析：**
1. **快速加载阶段** — 仅解析所有 `SKILL.md` 的 YAML 前置元数据，构建元数据索引（约占上下文 1%，约 2,000 tokens）
2. **惰性注入阶段** — 仅在实际调用技能时，才将完整 Markdown 正文编译为 prompt 块

**参考来源：**
- [agentskills.io SKILL.md 格式规范](https://agentskills.io/)
- [anthropics/skills — 官方参考实现](https://github.com/anthropics/skills)
- [Command Development SKILL.md — anthropics/claude-code](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/command-development/SKILL.md)
- [Plugin Structure SKILL.md](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/plugin-structure/SKILL.md)
- [Claude Code 技能实现剖析 — BestHub](https://www.besthub.dev/articles/how-claude-code-implements-skills-architecture-loading-and-execution-e09f4cb77359)

### 3. 注入 LLM 上下文

Claude Code 采用 **三级渐进式披露**：

| 层级 | 内容 | 预算 | 时机 |
|------|------|------|------|
| **第一层：元数据** | 技能名称 + 描述 | ~1% 上下文（约 2,000 tokens） | 启动后始终存在 |
| **第二层：指令** | 完整 `SKILL.md` 正文 | 无固定上限 | 调用时（用户或模型触发） |
| **第三层：资源** | `references/` 文件、`@path` 内容 | 按需 | 技能内显式请求 |

**Prompt 组装流水线**（共 10 阶段，来自社区逆向分析）：
- 技能元数据插入于 **S5 位置** — 在身份/行为 prompt 之后，但在 `CLAUDE.md` 内容之前
- 这意味着技能可以覆盖或细化 `CLAUDE.md` 中的项目级指令

**两种触发路径：**

1. **用户触发**（如 `/deploy staging`）：
   - Claude Code 将 `/deploy staging` 替换为技能的 Markdown 正文（`$1` → `staging`）
   - 注入系统消息 `<command-message>"deploy" 技能加载中</command-message>`
   - 从该点开始运行对话循环

2. **模型自动触发**：
   - 模型发出一个 `Skill` 工具调用块，指定技能名称
   - Claude Code 将技能正文作为下一轮对话注入
   - 这正是技能与工具的本质区别 — 工具扩展的是**能力**，技能扩展的是**专业知识**

**跨轮次的内容生命周期：**
- 调用后，技能内容成为消息历史的一部分
- 压缩时（`/compact`），技能内容与其他上下文一样被摘要
- 技能享有 **每个技能 5K tokens 的压缩保留预算**，以及 **总计 25K tokens 的合并预算**

**参考来源：**
- [Skills System — Inside Claude Code](https://y-agent.github.io/inside-claude-code/12-skills-system.html)
- [AgiFlow/claude-code-prompt-analysis](https://github.com/AgiFlow/claude-code-prompt-analysis)
- [Claude Code Prompt 架构 — BestHub](https://www.besthub.dev/articles/how-claude-code-implements-skills-architecture-loading-and-execution-e09f4cb77359)
- [Extend Claude with skills — 官方文档](https://code.claude.com/docs/en/skills)

### 4. 执行生命周期

**内联执行（默认）：**
1. 技能正文以用户消息形式注入当前对话
2. 模型遵循技能中的指令
3. 除非被 `tools` 字段限制，所有标准工具（Bash、Read、Write 等）均可用
4. 技能可访问完整的对话历史

**分支执行（`context: fork`）：**
1. 以隔离的对话上下文创建一个子代理（sub-agent）
2. 子代理以技能正文作为 prompt 运行
3. 仅 `tools` 字段中列出的工具可用
4. 子代理将结果返回给父对话
5. 适用于开销较大或副作用较重的操作，避免污染主上下文

**钩子（Hooks）作为独立的生命周期拦截器：**
- 覆盖代理生命周期的 25+ 个事件（PreToolUse、PostToolUse、Stop、BeforeMessage 等）
- 5 种钩子类型：Shell 命令、HTTP 端点、LLM Prompt、异步、MCP 工具
- 退出码语义：0 = 成功，2 = 阻止操作并将 stderr 展示给模型，其他 = 非阻塞错误
- 钩子提供**确定性**控制（始终触发） vs 技能提供**概率性**专业知识（模型自行决定何时调用）

**参考来源：**
- [Automate actions with hooks — 官方文档](https://code.claude.com/docs/en/hooks-guide)
- [Hooks reference — 官方文档](https://code.claude.com/docs/en/hooks)

### 5. 缓存与失效

- **Prompt 缓存**：首次请求后，元数据层受益于 Anthropic 的 prompt 缓存（缓存命中时约省 90% tokens）
- **内容去重**：相同技能的重复调用会被去重（同一技能正文不会发送两遍）
- **文件监听**：`.claude/skills/` 通过 OS 文件事件实时监控；变更即时生效
- **压缩存活性**：压缩期间每个技能保留 5K tokens，总计保留 25K tokens
- **符号链接去重**：软链接的技能目录会被检测并去重（防止双重加载）
- **云端会话同步**：启用云端会话特性时，技能配置跨机器同步

### 6. 关键源码参考

| 来源 | 用途 | URL |
|------|------|-----|
| `anthropics/claude-code` | 主仓库（插件、内置技能） | [github.com/anthropics/claude-code](https://github.com/anthropics/claude-code) |
| `anthropics/skills` | 参考技能实现 | [github.com/anthropics/skills](https://github.com/anthropics/skills) |
| `anthropics/claude-plugins-official` | 官方插件注册表 | [github.com/anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) |
| `agentskills.io` | 开放标准规范 | [agentskills.io](https://agentskills.io/) |
| AgiFlow prompt 分析 | 逆向工程 prompt 结构 | [github.com/AgiFlow/claude-code-prompt-analysis](https://github.com/AgiFlow/claude-code-prompt-analysis) |
| Inside Claude Code — Skills 系统 | 架构深度剖析 | [y-agent.github.io](https://y-agent.github.io/inside-claude-code/12-skills-system.html) |

> **注意：** Claude Code 的 npm 二进制文件是编译/混淆过的。源码级实现细节来源：开源的 `anthropics/claude-code` 插件系统、`anthropics/skills` 参考仓库，以及社区逆向分析。

---

## Cursor

Cursor 是一个闭源 AI 代码编辑器（基于 VS Code）。其规则/技能系统经过多次迭代，当前架构区分四种规则类型，并新增了对 Agent Skills 的支持。

### 1. 规则/技能的发现机制

Cursor 规则来自 **四个不同来源**：

| 来源 | 位置 | 同步 | 作用域 |
|------|------|------|--------|
| **团队规则** | 云端（Cursor Dashboard） | 每 30 分钟 | 组织全局 |
| **项目规则** | `.cursor/rules/*.mdc`（递归扫描） | 版本控制 | 单项目 |
| **用户规则** | Cursor 设置界面 | 本地设置 | 用户全局 |
| **Agent 文件** | `AGENTS.md`、`CLAUDE.md`（根目录及嵌套子目录） | 版本控制 | 单项目 |

**旧版 `.cursorrules`（已弃用）：**
- 项目根目录下的单个 `.cursorrules` 文件是最早的机制
- **自 v0.45 起弃用**
- **Cursor 3.x 的 Agent 模式完全忽略 `.cursorrules`** — 仅使用 `.cursor/rules/*.mdc` 文件
- Chat/Edit 模式可能仍保留兼容

**Agent Skills（新特性）：**
- 技能存放在 `.cursor/skills/` 目录
- 每个技能是一个文件夹，含 `SKILL.md` 文件，可选 `scripts/` 子目录
- 遵循 agentskills.io 标准

**参考来源：**
- [Cursor Rules — 官方文档](https://cursor.com/docs/rules)
- [Agent Skills — 官方文档](https://cursor.com/docs/context/skills)
- [Writesonic — Cursor Rules 指南](https://writesonic.com/blog/cursor-rules)
- [Roman.pt — Cursor 内部探秘](https://roman.pt/posts/cursor-under-the-hood/)

### 2. 解析与加载格式

**`.mdc` 文件（项目规则）：**

Cursor 使用 `.mdc`（Markdown Configuration）文件，带 YAML 前置元数据：

```yaml
---
description: 始终使用 AppError 处理错误
globs: "**/*.ts"
alwaysApply: false
---
# 错误处理规范

始终使用自定义 `AppError` 类代替原生 `Error`：
```ts
throw new AppError('User not found', 404);
```
```

**前置元数据字段：**
- `description` — 规则选取器中展示的描述
- `globs` — 自动附加的文件匹配模式
- `alwaysApply` — 为 true 时，无论上下文始终生效

**四种激活模式（由前置元数据推断）：**

| 模式 | 前置元数据 | 行为 |
|------|-----------|------|
| **始终生效** | `alwaysApply: true` | 每次请求均注入 |
| **自动附加** | 有 `globs`，`alwaysApply: false` | 当前文件匹配 globs 时附加 |
| **Agent 按需请求** | 仅有 `description` | 展示描述列表；Agent 在相关时获取正文 |
| **手动** | 无 description、无 globs、无 alwaysApply | 仅当用户显式通过 `@` 提及时生效 |

**Agent 文件（`AGENTS.md` / `CLAUDE.md`）：**
- 纯 Markdown，无需前置元数据
- 始终生效（等同于 `alwaysApply: true`）
- 在工作区根目录及嵌套子目录中发现

**技能（`SKILL.md`）：**
- YAML 前置元数据 + Markdown 正文，遵循 agentskills.io 标准
- 字段：`name`、`description`、`paths`（自动附加的文件模式）、`disable-model-invocation`、`metadata`

**参考来源：**
- [Cursor Rules — 官方文档](https://cursor.com/docs/rules)
- [Understanding Cursor Rules — Writesonic](https://writesonic.com/blog/cursor-rules)
- [Agent Skills — 官方文档](https://cursor.com/docs/context/skills)

### 3. 注入 LLM 上下文

基于社区逆向分析（Roman.pt 通过 ngrok 抓包）：

**会话首次请求：**
1. **系统 prompt** — Cursor 的基础 Agent 系统 prompt
2. **`<custom_instructions>` 块** — 包含：
   - 用户规则（从设置中读取）
   - `.cursorrules` 内容（如处于旧版模式）
   - **所有项目规则的编号名称和描述列表**（仅元数据，非完整正文）
3. **用户查询** — 实际用户消息

**惰性加载规则正文：**
- 规则描述在 `<custom_instructions>` 中急切列出
- 模型可通过 `fetch_rules` 工具调用按编号获取**指定规则的完整正文**
- 自动附加的规则（glob 匹配当前文件）会急切加载完整正文
- 始终生效的规则（`alwaysApply: true`）会急切加载完整正文

**设计理由：** 该惰性加载机制大幅节省上下文 tokens — 一个项目可能有 50 条规则，每条 1KB（共 50KB），但任意时刻仅需加载 1-3 条（约 3KB）。

**参考来源：**
- [Roman.pt — Cursor 内部探秘](https://roman.pt/posts/cursor-under-the-hood/)

### 4. 缓存与热重载

- **钩子**：显式文件监听，`hooks.json` 变更时自动重载
- **规则**：行为未明确文档化，社区观察表明可能是文件监听或每次请求重新扫描
- **团队规则**：每 30 分钟云端同步；更新自动推送给所有团队成员
- **设置变更**：通过设置界面添加的用户规则即时生效

### 5. 其他扩展机制

**Agent Skills：**
- 文件夹结构（`.cursor/skills/<name>/`）
- 每个技能含 `SKILL.md`（YAML 前置元数据 + Markdown 正文）
- 可选 `scripts/` 子目录存放打包脚本
- 技能出现在 `@` 提及选择器中，与规则并列

**钩子（Beta）：**
- 基于 JSON 的 stdio 生命周期拦截
- 18+ 个钩子事件覆盖完整代理生命周期
- 事件组织为 7 组：会话、消息、消息生成、文件变更后、工具前、工具后、工具调用后
- 钩子脚本通过 stdin 接收 JSON，通过 stdout 返回 JSON
- 退出码 0 = 成功；退出码 2 = 阻止操作

**自定义模式：**
- `.cursor/modes.json` 用于定义自定义 Agent 模式
- 每种模式可有自己的系统 prompt、工具权限和规则绑定

**参考来源：**
- [Hooks (Beta) — 官方文档](https://cursor.com/docs/hooks/overview)
- [GitButler — Cursor hooks 深度解析](https://blog.gitbutler.com/cursor-hooks-deep-dive/)
- [Custom Modes — 官方文档](https://cursor.com/docs/agent/modes)

### 6. 关键来源参考

| 来源 | 用途 | URL |
|------|------|-----|
| Cursor Rules 文档 | 规则官方文档 | [cursor.com/docs/rules](https://cursor.com/docs/rules) |
| Agent Skills 文档 | 技能系统文档 | [cursor.com/docs/context/skills](https://cursor.com/docs/context/skills) |
| Hooks 文档 | 钩子生命周期参考 | [cursor.com/docs/hooks/overview](https://cursor.com/docs/hooks/overview) |
| Roman.pt — 内部探秘 | Prompt 结构逆向分析 | [roman.pt](https://roman.pt/posts/cursor-under-the-hood/) |
| GitButler — Hooks 深度解析 | 钩子架构分析 | [blog.gitbutler.com](https://blog.gitbutler.com/cursor-hooks-deep-dive/) |
| Writesonic — Rules 指南 | 规则配置教程 | [writesonic.com](https://writesonic.com/blog/cursor-rules) |

> **注意：** Cursor 的 Agent 是闭源的。关于 prompt 结构、规则注入和惰性加载的实现细节来自社区逆向分析，非官方文档。

---

## OpenCode

> **注：** 原始的 `opencode-ai/opencode`（Go 语言 CLI）已归档。活跃开发在 [sst/opencode](https://github.com/sst/opencode)（TypeScript，Bun 运行时）持续进行。以下两者均覆盖。

### 1. 规则/技能的发现机制

**sst/opencode（当前版本）：**

两级发现：

1. **根目录的静态文件扫描** — `InstructionPrompt` 模块（`packages/opencode/src/session/instruction.ts`）定义了一个硬编码的文件扫描列表：

```typescript
const FILES = [
  "AGENTS.md",
  ...(Flag.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT ? [] : ["CLAUDE.md"]),
  "CONTEXT.md", // 已弃用
]
```

2. **子目录动态 AGENTS.md 发现** — 代理在代码库中导航时，子目录中发现的 AGENTS.md 文件会被动态解析和注入。这是 [commit 39a73d4](https://github.com/anomalyco/opencode/commit/39a73d4894bf7bda69a95b7d5572d5c7c24dd7ee) 中引入的关键特性。

3. **全局文件** — `globalFiles()` 还读取 `~/.config/opencode/AGENTS.md` 以及可选的 `~/.claude/CLAUDE.md`。

4. **技能系统**：通过 `.agents/skills/` 目录 — 每个技能是一个子目录，含 `SKILL.md` 和可选的 `references/` 子目录。

**opencode-ai/opencode（已归档的 Go 版本）：**

通过 `internal/config/config.go`（第 109-119 行）中的 `defaultContextPaths` 发现：

```go
var defaultContextPaths = []string{
    ".github/copilot-instructions.md",
    ".cursorrules",
    ".cursor/rules/",
    "CLAUDE.md",
    "CLAUDE.local.md",
    "opencode.md",
    "opencode.local.md",
    "OpenCode.md",
    "OpenCode.local.md",
    "OPENCODE.md",
    "OPENCODE.local.md",
}
```

### 2. 解析与加载格式

**sst/opencode：** 纯 Markdown 文件，遵循 [agents.md](https://agents.md/) 标准。技能支持 YAML 前置元数据（name、description、invokable）。

**Go 版本：** 纯文本/markdown 文件，通过 `os.ReadFile()` 读取，不解析特殊前置元数据。`.cursor/rules/` 目录通过 `filepath.WalkDir` 发现。

### 3. 注入 LLM 上下文

**sst/opencode：** `InstructionPrompt.resolve()`（基于 Effect 的服务）通过组合以下内容构建系统 prompt：
1. 基础 Agent 系统 prompt
2. 工作区根目录的初始 AGENTS.md 内容
3. 全局 AGENTS.md
4. 动态子目录 AGENTS.md（随代理探索逐步添加）

使用"增量"系统，指令按时间顺序累积。

**Go 版本：** 在 `GetAgentPrompt()` 中，上下文作为 `# Project-Specific Context` 节附加在系统 prompt 之后。关键细节：`getContextFromPaths()` 使用 `sync.Once` — 每个会话在启动时仅读取一次，之后永远缓存。会话期间不动态重读。

### 4. 缓存与失效

- **Go 版本：** 激进缓存 — `sync.Once` 意味着上下文文件仅读取一次，无失效机制。需要重启会话才能生效
- **SST 版本：** 基于 Effect 的架构允许重新解析。指令服务是可以重新调用的 Layer。动态子目录发现意味着新增的 AGENTS.md 文件在代理导航时会被拾取

### 5. 关键源码参考

| 文件 | 用途 | 永久链接 |
|------|------|----------|
| `internal/config/config.go` | `defaultContextPaths` 定义 | [第 109-121 行](https://github.com/opencode-ai/opencode/blob/main/internal/config/config.go#L109-L121) |
| `internal/llm/prompt/prompt.go` | `getContextFromPaths()`、`processFile()`、`sync.Once` 缓存 | [第 16-127 行](https://github.com/opencode-ai/opencode/blob/main/internal/llm/prompt/prompt.go) |
| `packages/opencode/src/session/instruction.ts` (sst) | 含 AGENTS.md 的指令解析 | [sst/opencode](https://github.com/sst/opencode/blob/5d2dc888/packages/opencode/src/session/instruction.ts) |

---

## Cline

Cline 是一个 VS Code 扩展、JetBrains 插件和 CLI 工具（npm：`@cline/cli`）。在开源编程代理中，它拥有可能是最精密的规则/指令系统。

### 1. 规则发现机制

Cline 从 **五个不同来源** 发现规则，统一到单个规则面板：

| 来源 | 位置 | 说明 |
|------|------|------|
| **Cline Rules** | `.clinerules/`（工作区）、`~/Documents/Cline/Rules`（全局） | 主要规则格式 |
| **Cursor Rules** | `.cursorrules`、`.cursor/rules/` | 自动检测 Cursor 配置 |
| **Windsurf Rules** | `.windsurfrules` | 自动检测 Windsurf 配置 |
| **AGENTS.md** | `AGENTS.md`（工作区根目录）、`~/.agents/AGENTS.md`（全局） | 跨工具标准 |
| **远程规则** | 通过 URL 获取 | 企业/团队共享 |

### 2. 解析与加载格式

**Cline Rules（`.clinerules/`）：**
- 读取目录下所有 `.md` 和 `.txt` 文件
- **YAML 前置元数据** 用于条件规则：`paths` 支持 glob 模式（`*`、`**`、`?`、`[abc]`、`{a,b}`）
- 无前置元数据的规则始终激活（"通用规则"）
- `paths: []` 表示永不自动激活（仅手动切换）
- 无效 YAML：**宽容处理** — 规则以原始内容可见的方式激活
- 跨工具规则（`.cursorrules`、`.windsurfrules`、`AGENTS.md`）作为纯文本原样读取

### 3. 注入 LLM 上下文

规则在 `src/core/task/index.ts` 中组装，调用 `getLocalClineRules()`、`getGlobalClineRules()` 及各跨工具规则加载函数。条件规则通过 `RuleEvaluationContext` 进行评估，考量的上下文包括：用户消息中的文件路径、打开的编辑器标签页、活动面板中的可见文件、Cline 在任务期间编辑过的文件、待处理文件操作等。规则以源标签前缀（如 `[Cline Rules]`、`[AGENTS.md]`）注入系统 prompt。

### 4. 执行生命周期

1. 启动/新任务：扫描所有规则源，加载开关状态
2. 每次 LLM 请求前：基于当前上下文评估条件规则，将活跃规则拼入系统 prompt
3. 任务中重新评估：Cline 编辑新文件或导航到新目录时触发重新评估
4. 开关变更：通过 `synchronizeRuleToggles()` 同步

### 5. 缓存与失效

- 规则在**每个任务开始时重新读取**，不在会话间缓存
- 开关状态持久化到磁盘
- 条件规则随上下文变化**动态重新评估**
- 远程规则每次会话重新获取

### 6. 关键源码参考

| 文件 | 用途 | 永久链接 |
|------|------|----------|
| `src/.../cline-rules.ts` | 本地 + 全局 Cline 规则加载 | [cline-rules.ts](https://github.com/cline/cline/blob/65e9727c/src/core/context/instructions/user-instructions/cline-rules.ts) |
| `src/.../external-rules.ts` | Cursor/Windsurf/AGENTS.md 加载 | [external-rules.ts](https://github.com/cline/cline/blob/main/src/core/context/instructions/user-instructions/external-rules.ts) |
| `src/.../rule-helpers.ts` | 前置元数据解析、文件内容拼装 | [rule-helpers.ts](https://github.com/cline/cline/blob/65e9727c/src/core/context/instructions/user-instructions/rule-helpers.ts) |
| `src/core/task/index.ts` | 任务级编排 — 调用规则加载器 | [task/index.ts](https://github.com/cline/cline/blob/main/src/core/task/index.ts) |
| `src/.../RuleContextBuilder.ts` | 条件规则上下文评估 | [RuleContextBuilder.ts](https://github.com/cline/cline/blob/main/src/core/context/instructions/user-instructions/RuleContextBuilder.ts) |

---

## Continue

Continue 是一个开源编程代理，支持 VS Code 扩展、JetBrains 插件和 CLI。截至最终 2.0.0 版本，`continuedev/continue` 仓库已只读。

### 1. 规则发现机制

分层规则发现系统：

1. `.continue/rules/` 中的 Markdown 规则（工作区和全局）
2. `.continue/prompts/` 中的 Markdown 提示词
3. 工作区根目录的 Agent 文件：`AGENTS.md`、`AGENT.md`、`CLAUDE.md`
4. `config.yaml`（或 `config.ts`）中定义的 YAML 配置规则
5. 从代码分析中发现的代码库规则

Agent 文件按优先级处理（`AGENTS.md` > `AGENT.md` > `CLAUDE.md`），每个工作区仅使用**第一个找到的**。

### 2. 解析与加载格式

Markdown 文件通过 `markdownToRule()` 解析，提取 `name`、`description`、`globs`（条件规则）、`regex`（内容匹配）、`alwaysApply`、`slug`、`invokable` 等字段。Agent 文件被加载为 `alwaysApply: true` 规则。

加载流程：`loadMarkdownRules()` → `getWorkspaceContinueRuleDotFiles()` → `getConfigYamlRules()` → 合并为 `RuleWithSource[]` 数组。

### 3. 注入 LLM 上下文

核心函数 `getSystemMessageWithRules()` 调用 `getApplicableRules()` 评估哪些规则适用，然后将规则用 `\n\n` 连接，附加在系统消息之后。

条件评估逻辑：
- `isGlobalRule()` — 当 `alwaysApply: true` 或无 globs 的顶级规则时始终适用
- `shouldApplyRule()` — 基于 globs 的文件路径匹配，基于 regex 的内容匹配
- 规则策略（`on`/`off`）用于开关覆写

### 4. 缓存与失效

- 规则在配置初始化时加载一次
- 存在用于代码库衍生规则的 `CodebaseRulesCache`
- 标准代码路径中没有会话中失效机制
- IDE 集成中的文件系统监听器可能触发重载

### 5. 关键源码参考

| 文件 | 用途 | 永久链接 |
|------|------|----------|
| `core/config/markdown/loadMarkdownRules.ts` | Markdown 规则发现 | [loadMarkdownRules.ts](https://github.com/continuedev/continue/blob/cf48e740/core/config/markdown/loadMarkdownRules.ts) |
| `core/llm/rules/getSystemMessageWithRules.ts` | 规则评估、条件匹配、系统消息组装 | [getSystemMessageWithRules.ts](https://github.com/continuedev/continue/blob/cf48e740/core/llm/rules/getSystemMessageWithRules.ts) |
| `core/config/profile/doLoadConfig.ts` | 顶层配置加载编排 | [doLoadConfig.ts](https://github.com/continuedev/continue/blob/cf48e740/core/config/profile/doLoadConfig.ts) |

---

## Aider

Aider 是一个基于终端的 AI 结对编程工具（Python）。与其他工具不同，Aider **没有**专用的规则/技能自动发现机制，采用手动加载方式。

### 1. 加载方式

1. **`CONVENTIONS.md` 文件** — 通过 `/read CONVENTIONS.md` 或 `--read CONVENTIONS.md` 手动加载
2. **`.aider.conf.yml`** — 运行时设置的 YAML 配置（非规则）
3. **`--system-prompt-extras`** — [PR #4818](https://github.com/Aider-AI/aider/pull/4818) 新增的标志，将文件内容追加到系统 prompt

### 2. 注入 LLM 上下文

Aider 在 `base_coder.py` 的 `format_chat_chunks()` 中使用分层消息组装：

1. 系统消息（main_system → system_prompt_prefix → system_reminder）
2. 示例消息
3. 已完成消息（摘要历史）
4. 仓库地图（代码库结构）
5. 只读文件 — **CONVENTIONS.md 出现于此**（作为 user/assistant 消息对注入）
6. 聊天文件（可编辑）
7. 当前消息
8. 提醒消息

`--system-prompt-extras` 标志的内容注入在**系统 prompt** 而非用户消息中。

### 3. 缓存与失效

- 配置文件：启动时加载一次，运行时不变
- 只读文件：添加时读取一次，仅在被 drop 后重新添加时才重读
- `--system-prompt-extras`：**每次 LLM 请求前动态重新读取**文件
- Aider **不监听**文件系统变更

---

## 横向对比总结

| 维度 | Claude Code | Cursor | OpenCode (SST) | Cline | Continue | Aider |
|------|-------------|--------|----------------|-------|----------|-------|
| **自动发现** | 是（6 层） | 是（4 源） | 是（AGENTS.md + CLAUDE.md） | 是（5 源） | 是（3 源） | 否（手动） |
| **文件格式** | .md（YAML 前置元数据） | .mdc / .md（YAML 前置元数据） | .md（YAML 前置元数据） | .md / .txt（YAML 前置元数据） | .md（YAML 前置元数据） | .md / .yml |
| **条件规则** | 是（模型自主决定调用） | 是（globs + alwaysApply） | 是（子目录级别） | 是（globs 在前置元数据） | 是（globs + regex） | 否 |
| **全局 + 本地** | 6 层（企业→内置） | 团队 + 项目 + 用户 + agent 文件 | ~/.config + 工作区 | Documents/ + 工作区 | 全局 + 工作区 | home + git 根 + cwd |
| **跨工具兼容** | 开放标准（agentskills.io） | AGENTS.md、CLAUDE.md | Cursor、Claude Code、AGENTS.md | Cursor、Windsurf、AGENTS.md | AGENTS.md、CLAUDE.md | 无 |
| **注入方式** | 三级渐进披露 + tool_use | 系统消息 + 惰性 fetch_rules | 系统 prompt（增量更新） | 系统 prompt（带源前缀） | 系统 prompt（追加） | 只读文件或系统 prompt |
| **缓存策略** | Prompt 缓存 + 文件监听 | 文件监听 + 30min 团队同步 | Effect 架构（可重新解析） | 每任务重读 | 配置加载时 | 每次请求或添加时 |
| **会话中重载** | 是（实时文件监听） | 是（文件监听） | 是（动态子目录发现） | 是（上下文重新评估） | 否（配置加载时） | 仅 --system-prompt-extras |
| **UI 开关** | 否 | 是（modes.json） | 否 | 是（每条规则可切换） | 是（rulePolicies） | 否 |
| **技能系统** | 一等公民（与命令统一） | 文件夹式（.cursor/skills/） | 是（.agents/skills/） | 通过 SDK 插件 + MCP | 通过 .continue/agents/ | 否 |
| **执行模型** | 内联或分支子代理 | Agent + 钩子拦截 | 内联 + 增量更新 | 内联 + 上下文重评 | 内联 | 内联 |
| **开放标准** | agentskills.io（发起者） | agentskills.io（支持） | 专有 | 专有 | 专有 | 不适用 |

---

## 关键设计模式提炼

### 1. "渐进披露" 模式（Claude Code）
技能分三层加载：元数据始终存在（约 2K tokens），完整指令按需注入，资源文件显式引用。最小化上下文膨胀，同时让模型持续感知可用能力。

### 2. "惰性获取" 模式（Cursor）
规则描述急切列出，正文按需通过 `fetch_rules` 工具调用获取。模型自行选择相关规则，以一次额外的 API 往返换取显著的上下文节省。

### 3. "扫描即缓存" 模式（OpenCode Go）
文件一次性扫描，结果不可变缓存。简单但缺乏灵活性。

### 4. "上下文求值" 模式（Cline、Continue）
每次请求前，规则对照当前上下文（打开文件、编辑过的文件、消息内容）进行求值。使条件规则不会浪费上下文 tokens。

### 5. "增量更新" 模式（OpenCode SST）
指令按时间顺序累积为增量。子目录中发现的新的 AGENTS.md 文件在会话期间动态注入。

### 6. "显式文件" 模式（Aider）
无自动发现，用户手动加载文件作为只读上下文。简单、可预测，但手动。

### 7. "多源联邦" 模式（Cline）
来自 5 个以上来源的规则（Cline、Cursor、Windsurf、AGENTS.md、远程）以源标签统一到单个系统中。拥有最全面的跨工具兼容性。

### 8. "YAML 前置元数据" 模式（Cline、Continue、Cursor、Claude Code）
Markdown 文件配 YAML 前置元数据存储元信息（name、globs、alwaysApply），正文为规则内容。在整个生态中几乎通用。

### 9. "工具分发技能" 模式（Claude Code）
不将所有技能内容注入系统 prompt，而是列出技能元数据，由模型发出 `Skill` 工具调用块来触发特定技能。这是"感知"与"执行"最清晰的分离。

---

*调研时间：2025 年 7 月。所有源码链接尽可能固定到特定 commit。*
