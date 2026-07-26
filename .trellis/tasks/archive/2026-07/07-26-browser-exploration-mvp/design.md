# 浏览器探索模块 MVP — 技术设计

## 1. 模块边界与数据流

```
┌─────────────────────────────────────────────────────────────────┐
│  index.ts (main)                                                │
│    startup: ... → browserWarmUp() → heartbeat                   │
│    shutdown: registerSignalHandlers → browserShutdown()          │
└──────────────┬──────────────────────────────────────────────────┘
               │ injects BrowserContext into ToolContext
               ▼
┌─────────────────────────────────────────────────────────────────┐
│  react.ts (ReAct loop)                                          │
│    systemPrompt += browserContextSection(ctx.browserContext)     │
│    tools = ToolManager.getTools(ctx)  // includes browser tools │
└──────────────┬──────────────────────────────────────────────────┘
               │ LLM calls browse_page / browse_snapshot / browse_act
               ▼
┌─────────────────────────────────────────────────────────────────┐
│  tools/browser/tools/  (3 ToolDefinitions)                      │
│    browse_page  → executor.execute('open', [url]) + read        │
│    browse_snapshot → executor.execute('snapshot', ['-i'])       │
│    browse_act   → executor.execute(action, [...args])           │
└──────────────┬──────────────────────────────────────────────────┘
               │ spawn('agent-browser', [...args, '--json', '--session', 'cyber-stray'])
               ▼
┌─────────────────────────────────────────────────────────────────┐
│  tools/browser/executor.ts  (BrowserExecutor)                   │
│    spawn async + AbortController timeout                         │
│    returns BrowserCommandResult { success, data, error, ms }    │
└──────────────┬──────────────────────────────────────────────────┘
               │ CLI IPC
               ▼
┌─────────────────────────────────────────────────────────────────┐
│  agent-browser daemon (常驻, auto-start on first command)        │
│    session: cyber-stray (isolated browser instance)              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  tools/browser/skills/  (Skill 文件系统, 独立于浏览器)            │
│    SkillParser → SkillIndex → browser_skill_list/load/create    │
│    存储: data/skills/<name>/SKILL.md                             │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Module 1: BrowserExecutor

### 2.1 文件布局

```
packages/agent/src/tools/browser/
├── executor.ts          # BrowserExecutor 类
├── types.ts             # CLI 返回类型
├── executor.test.ts     # 单元测试
scripts/
└── setup-agent-browser.ts  # 安装脚本
```

### 2.2 核心接口

```typescript
// types.ts
/** agent-browser --json 统一信封 */
export interface AgentBrowserEnvelope {
  success: boolean;
  data: Record<string, unknown> | null;
  error: string | null;
}

/** BrowserExecutor 返回 */
export interface BrowserCommandResult {
  success: boolean;
  data: Record<string, unknown> | null;
  error: string | null;
  durationMs: number;
}
```

### 2.3 BrowserExecutor 设计

```typescript
// executor.ts
export class BrowserExecutor {
  private sessionName: string;
  private timeoutMs: number;
  private binaryPath: string;  // 默认 'agent-browser'，可配 .bin/ 路径

  constructor(options?: { session?: string; timeout?: number; binaryPath?: string });

  /** 执行任意 CLI 命令 */
  async execute(command: string, args: string[] = []): Promise<BrowserCommandResult>;

  /** 预热：open about:blank，验证守护进程可用 */
  async warmUp(): Promise<boolean>;

  /** 关闭：close 命令 */
  async shutdown(): Promise<void>;

  /** 检查是否可用（doctor --json） */
  async isAvailable(): Promise<boolean>;
}
```

**实现要点**：
- 使用 `child_process.spawn`（非 execSync），Promise 封装
- 统一追加 `['--json', '--session', this.sessionName]`
- `AbortController` + `setTimeout` 实现超时（默认 30s，`AGENT_BROWSER_TIMEOUT` 环境变量覆盖）
- stdout 收集 → `JSON.parse` → `AgentBrowserEnvelope`
- stderr 收集 → 错误诊断
- 进程退出码非 0 → `success: false`
- 二进制不存在 → 捕获 ENOENT，返回友好错误
- **单例模式**：模块级 `let instance: BrowserExecutor | null`，`getBrowserExecutor()` 获取

### 2.4 安装脚本

```typescript
// scripts/setup-agent-browser.ts
// 1. npm install -g agent-browser（或检查已安装）
// 2. agent-browser install（下载 Chrome for Testing）
// 3. agent-browser doctor --json（验证）
```

`package.json` 新增：`"setup:browser": "tsx scripts/setup-agent-browser.ts"`

## 3. Module 2: 浏览器操作工具（3 个语义级）

### 3.1 工具设计

| 工具 | 输入 | 行为 | CLI 命令 |
|------|------|------|---------|
| `browse_page` | `{ url: string }` | 导航到 URL → 等待加载 → 读取内容 | `open <url>` + `read` |
| `browse_snapshot` | `{ interactive?: boolean, selector?: string }` | 获取页面可交互元素结构 | `snapshot -i [-s sel]` |
| `browse_act` | `{ action: ActionEnum, ...params }` | 执行交互操作 | 按 action 分发 |

### 3.2 browse_act action 枚举

```typescript
const BrowseActionEnum = z.enum([
  'click',       // { selector: string }
  'fill',        // { selector: string, text: string }
  'type',        // { selector: string, text: string }
  'press',       // { key: string }
  'scroll',      // { direction?: 'up'|'down'|'left'|'right', pixels?: number }
  'find_click',  // { locatorType: string, locatorValue: string }
  'find_fill',   // { locatorType: string, locatorValue: string, text: string }
  'wait',        // { condition: string } (text/url/selector/ms)
  'back',        // {}
  'tab_list',    // {}
  'tab_new',     // { url?: string }
  'tab_switch',  // { tabId: string }
  'tab_close',   // { tabId?: string }
]);
```

### 3.3 注册变更

**tool-manager.ts**：`category` 联合类型增加 `'browser'`

**tool-prompt.ts**：
```typescript
CATEGORY_NAMES: { ..., browser: '浏览器操作' }
CATEGORY_ORDER: ['search', 'web', 'browser', 'content', 'memory', 'feedback']
```

**auto-register.ts**：导入 3 个工具 + 3 个 skill 工具，加入 `TOOL_DEFINITIONS`

**context.ts**：`ToolContext` 增加 `browserContext?: BrowserContext`

### 3.4 工具文件布局

```
packages/agent/src/tools/browser/tools/
├── browse-page.ts
├── browse-snapshot.ts
├── browse-act.ts
└── index.ts          # barrel export
```

### 3.5 错误处理策略

- CLI 返回 `success: false` → 工具返回 `{ error: "..." }` 给 LLM（不抛异常）
- 超时 → `{ error: "浏览器操作超时 (30s)" }`
- 二进制不存在 → `{ error: "agent-browser 未安装，请运行 pnpm setup:browser" }`
- 浏览器未启用（config.browser.enabled = false）→ 工具不注册

## 4. Module 3: 浏览器守护进程生命周期

### 4.1 BrowserContext

```typescript
// lifecycle.ts
export interface BrowserContext {
  enabled: boolean;
  currentUrl: string | null;
  currentPageTitle: string | null;
  openTabs: Array<{ tabId: string; title: string; url: string; active: boolean }>;
  recentPages: Array<{ url: string; title: string; visitedAt: string }>;
  sessionStartTime: string;
}
```

### 4.2 生命周期函数

```typescript
// lifecycle.ts
export async function browserWarmUp(): Promise<BrowserContext | null>;
export async function browserShutdown(): Promise<void>;
export function buildBrowserPromptSection(ctx: BrowserContext | null): string;
```

- `warmUp()`：调用 `executor.warmUp()`，成功则构建初始 BrowserContext；失败返回 null（降级）
- `shutdown()`：调用 `executor.shutdown()`，忽略错误
- `buildBrowserPromptSection()`：生成 system prompt 片段

### 4.3 集成点

**index.ts main()**：
```
... → initFeishuWS() → loadState() → initializeInterestGraph()
    → browserWarmUp()  ← 新增（在 reflection scheduler 之前）
    → runStartupMemoryMaintenance() → initReflectionScheduler()
    → registerSignalHandlers() → startHeartbeat()
```

**registerSignalHandlers()**：增加 `browserShutdown()` 调用

**react.ts**：
- `ToolContext` 构建时注入 `browserContext`
- system prompt 追加 `buildBrowserPromptSection(ctx.browserContext)`

### 4.4 BrowserContext 更新时机

- `browse_page` 执行后：更新 `currentUrl`、`currentPageTitle`、追加 `recentPages`
- `browse_act` 的 `tab_*` 操作后：刷新 `openTabs`
- 每次游荡开始时：从 `session info --json` 同步最新状态

### 4.5 配置

```typescript
// types.ts AgentConfig 新增
browser?: {
  enabled: boolean;          // 默认 true
  warmUpOnStart: boolean;    // 默认 true
  closeAfterWander: boolean; // 默认 false（常驻模式）
  timeout: number;           // 默认 30000ms
  sessionName: string;       // 默认 'cyber-stray'
}
```

`config.ts` 中 `defaultBehavior` 增加 `browser` 嵌套对象，`loadBehaviorConfig()` 增加字段级合并。

## 5. Module 4: Skill 文件系统

### 5.1 目录结构

```
data/skills/
├── reddit-post/
│   ├── SKILL.md          # YAML frontmatter + Markdown 正文
│   └── references/       # 可选参考文件
│       └── example.md
└── hacker-news-read/
    └── SKILL.md
```

### 5.2 SKILL.md 格式

```markdown
---
name: reddit-post
description: 在 Reddit 上发帖的完整操作流程
state: active
---

## 步骤

1. 打开 https://www.reddit.com/submit
2. 填写标题 ...
```

### 5.3 核心接口

```typescript
// skills/parser.ts
export interface SkillMeta {
  name: string;
  description: string;
  state: 'active' | 'stale' | 'archived';
}

export interface ParsedSkill {
  meta: SkillMeta;
  content: string;  // Markdown 正文
  filePath: string;
}

export function parseSkillFile(raw: string, filePath: string): ParsedSkill;

// skills/index.ts (SkillIndex)
export interface SkillIndexEntry {
  name: string;
  description: string;
  filePath: string;
}

export class SkillIndex {
  constructor(skillsDir: string);
  scan(): void;                    // 扫描目录，构建内存索引
  list(): SkillIndexEntry[];       // 元数据列表
  load(name: string): ParsedSkill | null;  // 读取全文
  create(name: string, description: string, content: string): void;  // 写入 + 刷新
  patch(name: string, content: string): void;  // 更新已有
  has(name: string): boolean;
}
```

### 5.4 Skill 工具

| 工具 | 输入 | 输出 |
|------|------|------|
| `browser_skill_list` | `{}` | `{ skills: [{ name, description }] }` |
| `browser_skill_load` | `{ name: string }` | `{ name, description, content }` 或 `{ error }` |
| `browser_skill_create` | `{ name, description, content }` | `{ created: true, path }` 或 `{ error }` |

**browser_skill_create 硬校验**：
- name: `/^[a-z0-9-]+$/`，max 64 字符
- description: 非空，max 200 字符
- content: max 10KB
- 同名已有 → patch 路径（更新 SKILL.md）

### 5.5 文件布局

```
packages/agent/src/tools/browser/skills/
├── parser.ts
├── parser.test.ts
├── skill-index.ts
├── skill-index.test.ts
├── tool-list.ts
├── tool-load.ts
├── tool-create.ts
└── index.ts          # barrel export
```

## 6. 兼容性

- **无浏览器用户**：`browser.enabled = false` 或 agent-browser 未安装 → 工具不注册，启动不报错
- **现有测试**：不修改现有工具行为，所有现有测试不受影响
- **config 兼容**：`browser` 是可选嵌套对象，不存在时使用默认值

## 7. 回滚

- 删除 `packages/agent/src/tools/browser/` 目录
- 从 `auto-register.ts` 移除浏览器工具导入
- 从 `config.ts` / `types.ts` 移除 browser 配置
- 从 `index.ts` 移除 warmUp/shutdown 调用
- 各模块独立，可按模块粒度回滚
