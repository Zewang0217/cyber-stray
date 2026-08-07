# Agent Browser 集成调研

> **日期：** 2026-07-22
> **调研者：** AI Agent（通过 pi coding agent）
> **状态：** 调研完成 —— 可进入实现规划阶段

---

## 信息来源

| 来源 | URL | 备注 |
|------|-----|------|
| 官方文档 - 首页 | https://agent-browser.dev/ | 特性概览 |
| 官方文档 - 命令 | https://agent-browser.dev/commands | 完整 CLI 命令参考（50+ 命令） |
| 官方文档 - 安装 | https://agent-browser.dev/installation | 安装方式、doctor 诊断、系统依赖 |
| 官方文档 - 配置 | https://agent-browser.dev/configuration | 配置文件、环境变量、全部选项 |
| 架构文档 | https://vercel-labs-agent-browser.mintlify.app/concepts/architecture | 客户端-守护进程架构深入解析 |
| GitHub 仓库 | https://github.com/vercel-labs/agent-browser | 源码（Rust 85.7%，TS 11.3%）、README |
| npm 注册表 | https://registry.npmjs.org/agent-browser/latest | v0.33.0，Apache-2.0，Node >=24 |
| Skills 文档 | https://agent-browser.dev/skills | AI agent 技能安装 |

以上来源均在 2026-07-22 访问。

---

## agent-browser 是什么？

agent-browser 是 Vercel Labs 打造的**专为 AI Agent 设计的浏览器自动化 CLI 工具**。它**不是 JavaScript 库**——而是一个原生 Rust CLI 二进制文件，通过持久化 Node.js 守护进程管理由 Playwright 驱动的 Chromium 浏览器。

### 核心差异化特性

1. **Agent 优先设计**：输出为紧凑文本（无障碍树快照），而非冗长的 JSON。专为降低 LLM 上下文窗口消耗而设计。
2. **基于引用的元素选择**：快照返回无障碍树，其中可交互元素带有稳定引用标识（`@e1`、`@e2`……）。Agent 通过这些引用而非脆弱的 CSS 选择器进行交互。
3. **持久化浏览器守护进程**：浏览器在命令之间保持存活。首次启动耗时 2-3 秒；后续命令浏览器启动开销接近 0ms。
4. **100% 原生 Rust CLI**：亚毫秒级命令解析；Rust 二进制文件约 1-2 MB。
5. **完整的浏览器 API**：50+ 命令，覆盖导航、表单、输入、截图、网络拦截、Cookie/存储、标签页、iframe、对话框、下载、无障碍审计、React DevTools 集成、视频录制等。

### 许可证与定价

- **许可证**：Apache 2.0（开源）
- **定价**：免费。无付费层级，核心功能无需 API Key。
- **仓库**：https://github.com/vercel-labs/agent-browser（截至 2026 年 7 月约 39K stars，110+ 贡献者）
- **最新版本**：v0.33.0（npm；2026-07-19 发布）

---

## 架构

### 客户端-守护进程设计

```
+-----------------+     IPC（JSON over     +---------------------+     CDP      +---------------------+
|   Rust CLI      | -->  Unix Socket / TCP --> |   Node.js 守护进程   | --> Playwright --> |   Chromium 浏览器    |
|   (~1-2 MB)     |                          |   (~50-100 MB)       |     驱动层       |   (~200-500 MB)      |
+-----------------+                          +---------------------+                 +---------------------+
```

1. **Rust CLI**：原生代码解析命令（< 1ms 开销）。与守护进程通过以下方式通信：
   - macOS/Linux 上使用 Unix Domain Socket（`~/.agent-browser/{session}.sock`）
   - Windows 上使用 TCP localhost（端口范围 49152-65535）
   - 消息格式为换行分隔的 JSON

2. **Node.js 守护进程**：持久化后台进程，管理 Playwright 浏览器实例。**串行**处理命令（一次一个）以防止竞态。支持背压感知的 Socket 写入。首次命令时自动启动。

3. **Chromium 浏览器**：默认无头模式（通过 `--headed` 标志切换有头模式）。通过 `agent-browser install` 下载捆绑的 Chrome for Testing（首次安装时）。也可通过 `--executable-path` 使用自定义可执行文件，或通过 CDP（`--cdp`）连接到已有 Chrome。

### 守护进程生命周期

- **自动启动**：首条 CLI 命令触发生成守护进程并等待（~2-3s 启动 Chromium）
- **持久化**：守护进程在命令之间保持存活，等待下一条命令
- **优雅关闭**：通过 `close` 命令、`SIGINT`、`SIGTERM` 或意外错误触发
- **会话隔离**：`--session <name>` 创建完全隔离的守护进程，拥有独立的 socket、浏览器实例和状态
- **自动保存**：会话状态可通过 `--restore` 跨重启持久化

### 性能

| 指标 | 数值 |
|------|------|
| CLI 解析开销 | < 1ms（原生 Rust） |
| 守护进程 IPC 往返 | ~1-2ms（Unix Socket），~2-5ms（TCP） |
| 首次浏览器启动 | 2-3 秒 |
| 后续命令 | ~0ms 浏览器启动开销（守护进程已运行） |
| Rust CLI 内存 | ~1-2 MB |
| Node.js 守护进程内存 | ~50-100 MB |
| Chromium 内存 | ~200-500 MB（取决于页面复杂度） |

### 平台支持

| 平台 | 架构 | IPC 传输 | 原生二进制 |
|------|------|----------|------------|
| macOS | ARM64、x64 | Unix Socket | 是 |
| Linux | ARM64、x64 | Unix Socket | 是 |
| Windows | x64 | TCP localhost | 是 |

所有平台在原生二进制不可用时均回退到 Node.js。

---

## API 概览

### 命令分类

CLI 暴露 50+ 条命令，分为以下类别：

| 类别 | 关键命令 |
|------|---------|
| **核心导航** | `open <url>`、`back`、`forward`、`reload`、`pushstate`、`close` |
| **交互** | `click <sel>`、`dblclick`、`fill <sel> <text>`、`type`、`hover`、`focus`、`select`、`check`、`uncheck` |
| **键盘** | `press <key>`、`keyboard type <text>`、`keyboard inserttext <text>`、`keydown`、`keyup` |
| **滚动** | `scroll <dir> [px]`、`scrollintoview <sel>` |
| **鼠标** | `mouse move <x> <y>`、`mouse down/up`、`mouse wheel`、`drag <src> <dst>` |
| **读取** | `snapshot`（带引用的无障碍树）、`read [url]`（面向 Agent 的文本提取）、`eval <js>` |
| **信息** | `get text/html/value/attr/title/url/count/box/styles <sel>` |
| **查找** | `find role/text/label/placeholder/alt/title/testid/first/last/nth <...> <action>` |
| **等待** | `wait <sel>`、`wait <ms>`、`wait --text/--url/--load/--fn` |
| **截图** | `screenshot [path]`（支持 `--full`、`--annotate`、JPEG 质量选项） |
| **PDF** | `pdf <path>` |
| **标签页** | `tab`、`tab new`、`tab <id>`、`tab close`、`window new` |
| **iframe** | `frame <sel>`、`frame @ref`、`frame main` |
| **Cookie/存储** | `cookies`、`cookies set/clear`、`storage local/session` |
| **网络** | `network route/unroute`、`network requests`、`network har start/stop` |
| **设置** | `set viewport/device/geo/offline/headers/credentials/media` |
| **上传/下载** | `upload <sel> <files>`、`download <sel> <path>`、`wait --download` |
| **剪贴板** | `clipboard read/write/copy/paste` |
| **对话框** | `dialog accept/dismiss/status` |
| **认证** | `auth save/login/list/show/delete`（带插件支持的凭据保险箱） |
| **状态** | `state save/load/list/show/rename/clear/clean` |
| **调试** | `trace start/stop`、`profiler start/stop`、`record start/stop`（WebM）、`console`、`errors`、`highlight`、`inspect` |
| **React/性能** | `react tree/inspect/renders/suspense`、`vitals`（LCP/CLS/TTFB/FCP/INP） |
| **无障碍** | `a11y`（内嵌 axe-core 审计，无需 CDN） |
| **批量** | `batch`（一次调用执行多条命令） |
| **MCP 服务器** | `mcp`（Model Context Protocol stdio 服务器，供 MCP 兼容客户端使用） |
| **仪表盘** | `dashboard start/stop`（端口 4848 的 Web 可观测性界面） |
| **诊断** | `doctor`（完整诊断：环境、Chrome、守护进程、配置、网络、启动测试） |

### 快照 + 引用模式（核心工作流）

这是 agent-browser **面向 Agent 友好的关键设计模式**：

```
# 1. 导航
agent-browser open https://example.com

# 2. 获取带引用的无障碍树（-i = 仅可交互元素）
agent-browser snapshot -i
# 输出：
# @e1 [button] "登录"
# @e2 [input] "邮箱地址"
# @e3 [input] "密码"
# @e4 [link] "忘记密码？"
# @e5 [button] "创建账号"

# 3. 通过引用交互
agent-browser fill @e2 "user@example.com"
agent-browser fill @e3 "mypassword"
agent-browser click @e1

# 4. 页面变化后重新获取快照
agent-browser snapshot -i
```

引用（`@e1`、`@e2`……）的作用域限定在执行快照时处于活动状态的标签页。在同一快照内引用稳定，但在 DOM 变更后需重新获取快照。

### JSON 输出模式

`--json` 标志使所有命令返回结构化 JSON，是程序化集成的关键：

```bash
agent-browser --json open https://example.com
# 返回：{"status":"navigated","url":"https://example.com",...}

agent-browser --json snapshot -i
# 返回：{"elements":[{"ref":"@e1","role":"button","name":"登录"},...],...}
```

### MCP 服务器模式

agent-browser 可通过 stdio 作为 MCP（Model Context Protocol）服务器运行：

```bash
agent-browser mcp --tools core
```

MCP 客户端（Claude Desktop、Cursor 等）可将其作为子进程启动，通过 JSON-RPC 交互。工具配置文件包括 `core`、`network`、`state`、`debug`、`tabs`、`react`、`mobile` 和 `all`。这是**替代 child_process 包装 CLI 方案的有力选择**——Cyber Stray 可直接连接到 agent-browser 的 MCP 服务器。

---

## 安装要求

### 系统依赖

| 依赖项 | 详情 |
|--------|------|
| **Node.js** | >= 24.0.0（npm 包 `engines` 字段） |
| **pnpm** | >= 11.0.0（用于从源码构建） |
| **Chrome** | 通过 `agent-browser install` 从 Chrome for Testing 下载（约 684 MB） |
| **Linux 额外依赖** | `agent-browser install --with-deps` 安装系统库 |

### 安装方式

```
# 全局安装（推荐）
npm install -g agent-browser
agent-browser install

# 项目本地
npm install agent-browser       # 添加到 package.json
npx agent-browser install

# macOS Homebrew
brew install agent-browser
agent-browser install

# Cargo（Rust，从源码编译约 2-3 分钟）
cargo install agent-browser
agent-browser install
```

### Node.js 版本冲突

**关键问题：** agent-browser 要求 Node.js >= 24.0.0。Cyber Stray 当前使用 Node.js 20（依据 `packages/agent/package.json` 中的 `@types/node@^20`）。这是主要的集成风险：

- npm 包的 `postinstall` 脚本需要 Node 24+ 才能执行
- 守护进程本身是需要 Node 24+ 的 Node.js 进程
- 可选方案：
  1. 将 Cyber Stray 升级到 Node 24+（破坏性变更）
  2. 在独立的 Node 24+ 环境中运行 agent-browser（Docker、nvm 或独立进程）
  3. 使用全局安装（自带 Node.js 守护进程），而非作为项目依赖

### TypeScript 支持

agent-browser **不暴露** TypeScript/JavaScript API。它仅为 CLI 工具。没有 `import { ... } from 'agent-browser'` 这样的 SDK。集成必须通过以下方式：

1. **child_process**（spawn/exec CLI）
2. **MCP 协议**（连接到 `agent-browser mcp` 作为子进程，通过 stdio JSON-RPC）

对于 Cyber Stray 中的 TypeScript 类型，需自行定义以下接口：
- CLI 命令结果类型（从 `--json` 输出解析）
- MCP 工具 schema（若使用 MCP）
- 守护进程生命周期管理类型

---

## Cyber Stray 集成方案

### 当前工具架构（参考）

Cyber Stray 采用清晰的工具注册模式：

**ToolDefinition 接口**（`packages/agent/src/tools/tool-manager.ts`）：
```typescript
interface ToolDefinition {
  metadata: {
    name: string;
    description: string;          // 面向 LLM 的描述
    category?: 'search' | 'web' | 'content' | 'memory' | 'feedback';
    enabled?: boolean;
  };
  createTool: (ctx: ToolContext) => Tool;  // AI SDK Tool 工厂
}
```

**ToolContext**（`packages/agent/src/tools/registry/context.ts`）：
```typescript
interface ToolContext {
  state: AgentState;             // 当前 Agent 状态（精力、心情等）
  traceId: string;               // 游荡追踪 ID
  stepCount: number;             // 步数计数器
  wanderHistory: WanderStep[];   // 本次游荡历史记录
  visitedUrls: string[];         // 本次游荡访问的 URL
  spokeTimes: number;            // speak() 调用次数
  pendingFeedbackCount: number;
  endReason: 'rest' | 'max_steps' | 'low_energy' | 'error';
  startTime: number;
  searchQueries: SearchRecord[];
}
```

**注册入口**（`packages/agent/src/tools/registry/auto-register.ts`）：
```typescript
const TOOL_DEFINITIONS = [
  searchWebToolDef,
  readPageToolDef,
  speakToolDef,
  // ... 在此处添加 browserToolDef
];

export async function registerAllTools(): Promise<void> {
  ToolManager.batchRegister(TOOL_DEFINITIONS);
}
```

**ToolManager.getTools(ctx)** 返回 `Record<string, Tool>` 供 AI SDK 的 `generateText({ tools })` 使用。

**现有工具模式**（以 `search-web.ts` 为例）：
```typescript
export const searchWebToolDef: ToolDefinition = {
  metadata: { name: 'search_web', description: '...', category: 'search' },
  createTool: (ctx: ToolContext) => tool({
    description: '...',
    inputSchema: z.object({ query: z.string(), ... }),
    execute: async ({ query }) => {
      ctx.stepCount++;
      // ... 执行业务逻辑 ...
      pushWanderStep(ctx, { timestamp, tool: 'search_web', thought: '...' });
      return { results, total };
    },
  }),
};
```

### 浏览器工具设计

为 LLM Agent 提供浏览器能力，建议新增一个统一工具：

#### 方案：单一 `browse` 工具（推荐）

一个接受 `action` 参数的统一工具，涵盖最核心的浏览器操作：

```typescript
export const browseToolDef: ToolDefinition = {
  metadata: {
    name: 'browse',
    description: `使用浏览器自动化工具与网页交互。支持导航、快照、点击、填表、截图、读取等操作。

**核心工作流：**
1. 先用 action="navigate" 打开网页
2. 用 action="snapshot" 获取页面元素列表（含 @e1, @e2 等引用）
3. 用 action="click"/"fill"/"type" 等通过 ref 与元素交互
4. 交互后重新 snapshot 获取更新后的元素引用
5. 用 action="read" 获取当前页面的可读文本内容

**注意：** ref 引用仅在同一 snapshot 后有效，DOM 变化后需重新 snapshot。`,
    category: 'web',
  },
  createTool: (ctx: ToolContext) => tool({
    description: '...',
    inputSchema: z.object({
      action: z.enum([
        'navigate',    // 打开/跳转 URL
        'snapshot',    // 获取带引用的无障碍树（-i）
        'click',       // 通过引用点击元素
        'fill',        // 通过引用填写输入框
        'type',        // 通过引用键入文本
        'press',       // 按键
        'scroll',      // 滚动页面
        'read',        // 读取页面内容（面向 Agent 的文本）
        'screenshot',  // 截图
        'back',        // 后退
        'forward',     // 前进
        'reload',      // 刷新
        'wait',        // 等待元素/时间
        'close',       // 关闭浏览器
      ]).describe('要执行的浏览器操作'),
      url: z.string().optional().describe('URL（navigate 操作必填）'),
      selector: z.string().optional().describe('元素引用（@e1）或 CSS 选择器（click/fill/type 操作必填）'),
      value: z.string().optional().describe('输入值（fill/type/press 操作使用）'),
      waitMs: z.number().optional().describe('等待毫秒数（wait 操作使用）'),
      scrollDirection: z.enum(['up', 'down', 'left', 'right']).optional().describe('滚动方向'),
      scrollPx: z.number().optional().describe('滚动像素数'),
    }),
    execute: async (params) => {
      // 根据 params 构建 CLI 命令
      // 通过 child_process.execSync 或 spawn 执行
      // 解析 --json 输出
      // 更新 ctx（visitedUrls、wanderHistory、stepCount）
      // 返回结果
    },
  }),
};
```

**注意：** 初始集成中不暴露 `eval` 操作（安全风险），不暴露 `network route`（SSRF 风险）。

#### 为什么是单一工具而非多个？

- 与现有 `search_web` 模式一致（一个工具 + quality 参数）
- 减少 LLM 上下文窗口中的工具数量
- action 枚举提供清晰的命令可发现性
- agent-browser 本身就是一个内聚的整体能力

### 实现策略：CLI 包装 vs MCP

集成 agent-browser 有两条技术路线：

#### 方案一：child_process CLI 包装（更简单）

```typescript
// packages/agent/src/tools/browser/cli.ts
import { execSync } from 'child_process';

const AGENT_BROWSER_BIN = 'agent-browser'; // 假设全局安装或 npx

export function browserCommand(args: string[], options?: { timeout?: number }): string {
  const cmd = `${AGENT_BROWSER_BIN} ${args.join(' ')}`;
  return execSync(cmd, {
    encoding: 'utf-8',
    timeout: options?.timeout ?? 30_000,
    maxBuffer: 5 * 1024 * 1024, // 5MB
  });
}
```

**优点：** 简单，无协议依赖，快速实现。
**缺点：** 每次命令一个子进程；需自行管理守护进程生命周期；不支持流式。

#### 方案二：MCP 客户端（更健壮）

```typescript
// 连接到 agent-browser MCP 服务器作为子进程
// 通过 stdio 交换 JSON-RPC
// 使用 @modelcontextprotocol/sdk Client 类
```

**优点：** 持久连接，类型化工具 schema，自动管理守护进程生命周期，流式支持，标准协议。
**缺点：** 增加 MCP SDK 依赖，配置更复杂，守护进程生命周期不透明。

**推荐：** 先用**方案一**（CLI 包装）快速集成，后续如需性能或可靠性提升再迁移到 MCP。CLI 方案依赖最小、易于调试。

### 执行器设计

```typescript
// packages/agent/src/tools/browser/executor.ts

export interface BrowserCommandResult {
  success: boolean;
  data: unknown;        // 从 --json 输出解析的结构化数据
  rawOutput: string;    // 原始 stdout（用于截图路径等非 JSON 命令）
  stderr: string;
  durationMs: number;
}

export class BrowserExecutor {
  private static sessionName: string;

  /**
   * 执行一条 agent-browser CLI 命令。
   * 首次命令会自动触发守护进程启动。
   */
  static async execute(args: string[]): Promise<BrowserCommandResult> {
    // 1. 构建带 --json 和 --session 的完整参数
    const fullArgs = ['--json', '--session', this.sessionName, ...args];

    // 2. 通过 child_process 执行
    // 3. 解析输出，处理错误
    // 4. 返回结构化结果
  }

  static async close(): Promise<void> {
    // 发送 close 命令关闭守护进程
  }
}
```

### 生命周期管理

| 阶段 | 策略 |
|------|------|
| **安装** | 项目初始化时执行一次 `npx agent-browser install`（或在 Dockerfile 中）。作为 README 中的前置条件文档化。 |
| **守护进程启动** | 懒启动。首次 `browse` 工具调用自动触发守护进程启动（~2-3s）。也可在 `initFeishuWS()` 阶段预热。 |
| **会话隔离** | 使用 `--session cyber-stray` 与同机其他 agent-browser 使用隔离。 |
| **单次游荡内** | 在单次 `runAgentLoop()` 调用内保持浏览器存活，跨步骤复用。游荡结束后关闭以释放内存。 |
| **全局** | 不建议跨游荡保持持久化守护进程。风险：内存累积。 |
| **关闭** | 在 `SIGINT`/`SIGTERM` 时发送 `agent-browser close --all` 清理。在 `registerSignalHandlers()` 中注册。 |
| **错误恢复** | 守护进程崩溃后，下一条命令自动重启。所有 CLI 调用包在 try/catch 中，配合 `BrowserExecutor.reset()`。 |

**推荐：** 每次游荡结束后（`runAgentLoop` 返回后）关闭浏览器，保持内存使用有界且防止游荡间状态泄漏。

### 配置变更

#### 新增环境变量

```bash
# .env 新增
AGENT_BROWSER_PATH=/usr/local/bin/agent-browser    # 二进制路径（在 PATH 中则自动检测）
AGENT_BROWSER_HEADED=false                         # 设为 true 用于调试
AGENT_BROWSER_TIMEOUT=30000                        # 每条命令超时（ms）
AGENT_BROWSER_MAX_OUTPUT=50000                     # 截断页面输出以保护 LLM 上下文
AGENT_BROWSER_SESSION=cyber-stray                  # 会话名称，用于隔离
```

#### agent-config.json 新增

```json
{
  "browser": {
    "enabled": true,
    "maxOutputChars": 50000,
    "commandTimeoutMs": 30000,
    "closeAfterWander": true,
    "allowedDomains": []
  }
}
```

#### 配置类型扩展

```typescript
// 在 packages/agent/src/types.ts 的 AgentConfig 中新增：
browser?: {
  enabled: boolean;
  maxOutputChars: number;
  commandTimeoutMs: number;
  closeAfterWander: boolean;
  allowedDomains: string[];
};
```

### 安全考量

| 风险 | 缓解措施 |
|------|---------|
| **恶意网站** | agent-browser 的 `--allowed-domains` 标志限制导航白名单。初期不做限制以探索，后续增加可配置的域名白名单。 |
| **Cookie/会话泄漏** | 使用 `--session cyber-stray` 隔离。游荡间执行 `agent-browser cookies clear`。不开启持久化 profile。 |
| **XSS / eval 风险** | **初始集成不暴露 `eval` 操作**。未来若需添加，配合 `--confirm-actions eval` 要求显式确认。 |
| **iframe 嵌入** | agent-browser 在快照中自动处理 iframe（内联引用）。iframe 源之外的场景无额外安全风险。 |
| **文件系统访问** | 截图和 PDF 写入磁盘。使用 `--screenshot-dir` 控制输出位置。下载默认使用临时目录（关闭时删除）。 |
| **网络拦截** | `network route` 可拦截/模拟请求。**不向 LLM 暴露网络路由工具。** |
| **SSRF / 内网访问** | 浏览器与 Agent 运行于同一机器。使用 `--allowed-domains` 防止访问内网（localhost、192.168.x.x、10.x.x.x）。 |
| **资源耗尽** | Chromium 可消耗大量 CPU/内存。`closeAfterWander: true` 至关重要。设置 `--idle-timeout 5m` 作为安全兜底。 |

### 性能与资源影响

| 资源 | 估算 | 备注 |
|------|------|------|
| **安装体积** | ~684 MB（Chrome for Testing） | 一次性下载 |
| **运行时内存** | ~250-600 MB 总计 | Rust CLI 1-2MB + Node 守护进程 50-100MB + Chromium 200-500MB |
| **首次导航** | 2-3 秒 | 浏览器冷启动 |
| **后续命令** | 100-500ms | 取决于页面复杂度和网络 |
| **单次游荡开销** | 每次游荡打开并关闭浏览器 | 若 `closeAfterWander: true` |
| **对心跳的影响** | 无（浏览器按游荡生命周期，不按心跳） | 浏览器仅在 `runAgentLoop()` 期间运行 |

**关键考量：** Cyber Stray 的心跳间隔为 10-30 秒。每次游荡的 2-3s 浏览器冷启动是可以接受的，因为游荡仅在无聊值超过阈值时触发（通常每隔几分钟一次）。如果游荡频率变高，可考虑跨游荡保持守护进程存活。

---

## 现有 `read_page` vs agent-browser `read` 对比

Cyber Stray 已有基于 `jsdom` + `Readability` 的 `read_page` 工具：

| 特性 | 现有 `read_page` | agent-browser `read` |
|------|-----------------|---------------------|
| **JS 渲染** | 不支持（仅静态 HTML） | 支持（完整 Chromium 渲染） |
| **SPA 支持** | 不支持 | 支持（执行 JS，等待内容） |
| **登录态** | 不支持（无状态 HTTP） | 支持（Cookie、localStorage） |
| **依赖** | jsdom、@mozilla/readability（轻量） | agent-browser CLI + Chromium（重） |
| **性能** | 快（大多数页面 < 1s） | 慢（需要浏览器 + 页面加载） |
| **反爬检测** | 简单 User-Agent 头 | 真实浏览器指纹（更难检测） |
| **内存使用** | 可忽略 | Chromium ~200-500 MB |
| **输出质量** | 文章文本提取良好 | 复杂页面、SPA 更好 |
| **链接提取** | 支持（从静态 DOM） | 还可通过快照提取渲染后的链接 |

**推荐：** 保留 `read_page` 作为默认页面阅读器。agent-browser 仅用于需要 JS 渲染、登录态或交互式导航的页面。`browse` 工具的 `read` 操作应定位为高级/升级选项，而非替代品。

---

## 待解问题与风险

### 高优先级

1. **Node.js 24 要求**：Cyber Stray 使用 Node 20。是升级项目到 Node 24，还是为 agent-browser 使用独立运行时？这是最大阻碍。

2. **Docker/CI 兼容性**：捆绑的 Chromium 在 Docker 中需要 `--no-sandbox`。需测试 `agent-browser install` 在 CI 中可正常工作，以及守护进程在无显示服务器时能正常运行。agent-browser 文档提到 Linux 上的自动 Xvfb，有帮助。

3. **跨平台验证**：agent-browser 支持 macOS、Linux 和 Windows，但 Windows 的 IPC 使用 TCP localhost 而非 Unix Socket。需验证 Windows 开发环境下的正常工作。

4. **守护进程崩溃的错误处理**：如果守护进程在游荡中途崩溃，后续工具调用将全部失败。`BrowserExecutor` 需要重试/重启机制。

### 中优先级

5. **Token 预算影响**：完整浏览器自动化可能比静态页面阅读消耗更多 LLM 上下文（快照可能很大）。需要 `--max-output` 或 `--content-boundaries` 安全措施。

6. **并发游荡**：当前架构串行执行游荡（一次一个 `runAgentLoop`），并发浏览器会话不成问题。但如果未来引入并行游荡，会话隔离将变得关键。

7. **兴趣图谱集成**：浏览交互可反馈进兴趣图谱（访问的页面、停留时间、交互操作）。这是后续增强项。

8. **截图存储**：截图作为 LLM 上下文消费需要管理。考虑是否支持视觉模型（如 GPT-4V）直接消费截图。

### 低优先级

9. **认证保险箱集成**：agent-browser 的 `auth save/login` 命令可让 Cyber Stray 登录网站。功能强大但增加安全复杂度（凭据存储）。

10. **视频录制**：`agent-browser record start/stop` 可捕获浏览器会话用于调试。锦上添花，非 MVP。

---

## 结论与建议

### 总体判断：谨慎推进——可行，但 Node.js 版本风险显著

agent-browser 是一个设计精良、与 Cyber Stray 架构（Agent 驱动的浏览器自动化）高度契合的优秀工具。基于引用的快照模式尤其适合 LLM 工具调用场景。但 **Node.js >= 24 的要求是必须首先解决的阻碍**。

### 推荐集成路径

**第一阶段：可行性验证（1-2 天）**
1. 解决 Node.js 版本约束（升级项目到 Node 24 或使用独立运行时）
2. 在开发环境全局安装 agent-browser
3. 手动测试：验证 `agent-browser install`、`doctor`、基本命令是否正常工作
4. 如在 Docker/CI 中使用则同步测试

**第二阶段：最小可用工具（2-3 天）**
1. 创建 `packages/agent/src/tools/browser/` 模块
2. 实现 `BrowserExecutor` 类（基于 `execSync` 的 CLI 包装）
3. 实现 `browse` ToolDefinition，action 包括：`navigate`、`snapshot`、`click`、`fill`、`read`、`screenshot`
4. 在 `auto-register.ts` 中注册
5. 在 `runAgentLoop` 中添加浏览器生命周期钩子（游荡开始时打开，结束时关闭）
6. 在 `registerSignalHandlers` 中添加关闭时清理

**第三阶段：加固（1-2 天）**
1. 添加 `--allowed-domains` 配置
2. 添加 `--max-output` 和 `--content-boundaries` 安全措施
3. 添加命令超时处理
4. 错误恢复：守护进程崩溃后重启
5. 编写使用 mock `execSync` 的单元测试
6. 用真实游荡进行手动集成测试

**第四阶段：后续增强（backlog）**
1. 视觉模型消费截图
2. 用 MCP 客户端替代 CLI 包装
3. 跨游荡持久化浏览器会话（可配置）
4. 认证保险箱集成，支持登录态浏览
5. 浏览历史反馈到兴趣图谱

### 需要决策

> **是将 Cyber Stray 升级到 Node.js >= 24，还是将 agent-browser 运行在 sidecar 进程（Docker、带自有 Node 的 npx）中？**

这个决策决定了第一阶段的方案和时间线。升级项目到 Node 24 长期更简单，但可能破坏其他依赖。sidecar 方案能规避升级风险，但增加运维复杂度（管理两个 Node 运行时）。

---

## 附录：工具设计 CLI 命令速查

以下是与 `browse` 工具最相关的命令：

```bash
# 导航
agent-browser --json --session cyber-stray open <url>
agent-browser --json --session cyber-stray back
agent-browser --json --session cyber-stray reload

# 快照（带引用的无障碍树）
agent-browser --json --session cyber-stray snapshot -i

# 交互（通过快照引用）
agent-browser --json --session cyber-stray click @e1
agent-browser --json --session cyber-stray fill @e2 "文本"
agent-browser --json --session cyber-stray type @e3 "文本"
agent-browser --json --session cyber-stray press Enter

# 阅读
agent-browser --json --session cyber-stray read
agent-browser --json --session cyber-stray read <url> --max-output 50000

# 截图
agent-browser --json --session cyber-stray screenshot --annotate

# 滚动
agent-browser --json --session cyber-stray scroll down 300
agent-browser --json --session cyber-stray scrollintoview @e10

# 清理
agent-browser --json --session cyber-stray close
```

---

*调研文档结束。*
