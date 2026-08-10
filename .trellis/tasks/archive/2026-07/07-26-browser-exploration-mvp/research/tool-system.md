# Tool System Research

> Researched: 2026-07-26 | Package: `@cyber-stray/agent`

## 1. Tool Registration Pattern

**File:** `packages/agent/src/tools/registry/auto-register.ts`

All tools are registered via a centralized array + batch registration:

```typescript
import { ToolManager } from '../tool-manager.js';
import { searchWebToolDef } from './search-web.js';
import { readPageToolDef } from './read-page.js';
// ... more imports

/** 所有工具定义列表 */
const TOOL_DEFINITIONS = [
  searchWebToolDef,
  readPageToolDef,
  speakToolDef,
  restToolDef,
  recordKnowledgeToolDef,
  observeUserToolDef,
  readFeedbackToolDef,
  processFeedbackToolDef,
];

/** Agent 启动时调用此函数 */
export async function registerAllTools(): Promise<void> {
  ToolManager.batchRegister(TOOL_DEFINITIONS);
}
```

**To add a new tool:**
1. Create `packages/agent/src/tools/registry/<tool-name>.ts` exporting a `ToolDefinition`
2. Import it in `auto-register.ts` and add to `TOOL_DEFINITIONS` array
3. (Optional) Add a new category to `tool-prompt.ts` if needed

**Initialization flow:** `ToolManager.initialize()` → dynamic import `auto-register.js` → `registerAllTools()` → `batchRegister()`

---

## 2. Core Interfaces

### ToolDefinition & ToolMetadata

**File:** `packages/agent/src/tools/tool-manager.ts`

```typescript
import type { Tool } from 'ai';
import type { ToolContext } from './registry/context.js';

/** 工具元信息（用于 Prompt 生成） */
export interface ToolMetadata {
  name: string;
  description: string;
  category?: 'search' | 'web' | 'content' | 'memory' | 'feedback';
  enabled?: boolean;
}

/** 工具定义（包含元信息 + 执行器工厂） */
export interface ToolDefinition {
  metadata: ToolMetadata;
  createTool: (ctx: ToolContext) => Tool;
}

/** 工具统计信息 */
export interface ToolStats {
  total: number;
  enabled: number;
  disabled: number;
  byCategory: Record<string, number>;
}
```

**Key points:**
- `category` is a string union: `'search' | 'web' | 'content' | 'memory' | 'feedback'`
- `enabled` defaults to `true` if not explicitly `false`
- `createTool` is a factory that receives `ToolContext` and returns a Vercel AI SDK `Tool`
- Re-exported from `packages/agent/src/tools/registry/index.ts`

### ToolContext

**File:** `packages/agent/src/tools/registry/context.ts`

```typescript
import type { AgentState, WanderStep } from '../../types.js';

export interface SearchRecord {
  query: string;
  quality: 'free' | 'premium';
  timestamp: string;
}

/** Tool 执行上下文（在 Tool execute 中共享的 mutable 状态） */
export interface ToolContext {
  state: AgentState;
  traceId: string;              // 本次游荡的唯一追踪 ID
  stepCount: number;            // 步数计数器（每次 tool call +1）
  wanderHistory: WanderStep[];  // 游荡历史记录
  visitedUrls: string[];        // 访问过的 URL
  spokeTimes: number;           // speak 调用次数
  pendingFeedbackCount: number; // 待处理反馈数量
  endReason: 'rest' | 'max_steps' | 'low_energy' | 'error';
  startTime: number;            // 游荡开始时间（ms）
  searchQueries: SearchRecord[]; // 搜索词归档
}

/** 向 ctx.wanderHistory 追加一条步骤记录（上限 50 条，自动丢弃最旧） */
export function pushWanderStep(ctx: ToolContext, step: WanderStep): void { ... }
```

### ToolManager API

**File:** `packages/agent/src/tools/tool-manager.ts`

Static class with these key methods:
- `ToolManager.register(def)` — register single tool
- `ToolManager.batchRegister(defs)` — register array of tools
- `ToolManager.setEnabled(name, enabled)` — toggle tool on/off
- `ToolManager.isEnabled(name)` — check if enabled
- `ToolManager.getMetadata(enabledOnly?)` — get all metadata
- `ToolManager.getTools(ctx)` — instantiate all enabled tools for AI SDK
- `ToolManager.getToolsFiltered(ctx, { only?, exclude? })` — filtered instantiation
- `ToolManager.initialize()` — startup init (calls registerAllTools)
- `ToolManager.reset()` — clear all (for tests)

---

## 3. Concrete Tool Example (read_page — simplest complete pattern)

**File:** `packages/agent/src/tools/registry/read-page.ts`

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { consola } from '../../logger.js';
import { config } from '../../config.js';
import { readPage } from '../page/reader.js';
import { pushWanderStep, type ToolContext } from './context.js';
import { getVisitedInfo, isInCooldown } from '../dedup/url-tracker.js';
import type { ToolDefinition } from '../tool-manager.js';

const logger = consola.withTag('tool:read_page');

const READ_PAGE_DESCRIPTION = '点开一个链接，阅读网页内容，看看里面有什么';

/** 读取页面工具定义 */
export const readPageToolDef: ToolDefinition = {
  metadata: {
    name: 'read_page',
    description: READ_PAGE_DESCRIPTION,
    category: 'web',
  },
  createTool: (ctx: ToolContext) => tool({
    description: READ_PAGE_DESCRIPTION,
    inputSchema: z.object({
      url: z.string().url().describe('要阅读的网页地址'),
    }),
    execute: async ({ url }) => {
      ctx.stepCount++;
      const stepStart = Date.now();

      // Business logic...
      const result = await readPage(url);
      const elapsed = Date.now() - stepStart;

      // Logging
      logger.info(`[${ctx.traceId}] TOOL read [url=${url} elapsed=${elapsed}ms]`);

      // Record wander step
      pushWanderStep(ctx, {
        timestamp: new Date().toISOString(),
        tool: 'read_page',
        url,
        thought: result.error ? `读取失败: ${result.error}` : `读取: ${result.title}`,
      });

      return result;
    },
  }),
};

/** 向后兼容别名 */
export const createReadPageTool = (ctx: ToolContext) => readPageToolDef.createTool(ctx);
```

### Tool Pattern Checklist

Every tool follows this pattern:
1. **Imports:** `tool` from `'ai'`, `z` from `'zod'`, `consola`, `config`, `pushWanderStep`/`ToolContext`, `ToolDefinition`
2. **Logger:** `consola.withTag('tool:<name>')`
3. **Description constant:** Rich markdown description string (used both in metadata AND tool())
4. **Export `xxxToolDef: ToolDefinition`** with:
   - `metadata: { name, description, category }`
   - `createTool: (ctx) => tool({ description, inputSchema, execute })`
5. **Inside execute:**
   - `ctx.stepCount++` (always first)
   - Timing with `Date.now()`
   - Core logic
   - `logger.info(...)` with traceId
   - `pushWanderStep(ctx, { timestamp, tool, thought })`
   - Return result object
6. **Backward-compat alias:** `export const createXxxTool = (ctx) => xxxToolDef.createTool(ctx)`

### Template File

**File:** `packages/agent/src/tools/registry/_template.ts` — exists but uses the OLD pattern (function export, not ToolDefinition). New tools should follow the `ToolDefinition` pattern shown above.

---

## 4. Tool Prompt System

**File:** `packages/agent/src/tools/tool-prompt.ts`

Generates markdown tool descriptions for the system prompt:

```typescript
/** 分类显示名称 */
const CATEGORY_NAMES: Record<string, string> = {
  search: '搜索',
  web: '网页浏览',
  content: '内容创作',
  memory: '记忆管理',
  feedback: '反馈处理',
  other: '其他',
};

/** 分类顺序 */
const CATEGORY_ORDER = ['search', 'web', 'content', 'memory', 'feedback'];
```

**`buildToolsDescription()`** — groups tools by category, outputs markdown:
```
**搜索：**
- `search_web` — 搜索互联网获取信息...

**网页浏览：**
- `read_page` — 点开一个链接...
```

**To add a new category (e.g. 'browser'):**
1. Add to `CATEGORY_NAMES`: `browser: '浏览器操作'`
2. Add to `CATEGORY_ORDER` array at desired position
3. Add `'browser'` to the `ToolMetadata.category` union type in `tool-manager.ts`

**`buildToolsSummary()`** — one-line debug summary of enabled tools.

---

## 5. Config System

**File:** `packages/agent/src/config.ts`  
**Types:** `packages/agent/src/types.ts`

### Architecture

- **Behavior config** → loaded from `data/agent-config.json` (JSON file, optional)
- **Sensitive config** → environment variables only
- **Merged into** → single `export const config: AgentConfig`

### How to add new config fields

1. **Add to `AgentConfig` interface** in `packages/agent/src/types.ts`
2. **Add to `BehaviorConfig` type** in `config.ts` (if it should be overridable via JSON)
3. **Add default value** to `defaultBehavior` object in `config.ts`
4. **If nested object:** add explicit field-level merge in `loadBehaviorConfig()` (see `consolidation`, `interests`, `pushGate` patterns)
5. **If env-var based:** add to the `config` object construction at bottom of `config.ts`

### Nested config merge pattern (important!)

```typescript
// In loadBehaviorConfig():
return {
  ...defaultBehavior,
  ...file,
  // Nested objects need explicit field-level merge:
  consolidation: {
    ...defaultBehavior.consolidation,
    ...(file.consolidation ?? {}),
  },
  pushGate: {
    ...defaultBehavior.pushGate,
    ...(file.pushGate ?? {}),
    weights: {
      ...defaultBehavior.pushGate.weights,
      ...(file.pushGate?.weights ?? {}),
    },
    // ... deeper nesting same pattern
  },
};
```

### AgentConfig interface (relevant subset)

```typescript
export interface AgentConfig {
  heartbeatInterval: number;
  boredomGrowthRate: number;
  energyRecoveryRate: number;
  boredomThreshold: number;
  energyThreshold: number;
  energyRecoveringThreshold: number;
  energyCostPerStep: number;
  boredomReductionPerStep: number;
  wanderProbabilityEnabled: boolean;
  wanderProbabilityThreshold: number;
  energyRecoveryTiers: EnergyRecoveryTier[];
  llmModel: string;
  llmTemperature: number;
  maxWanderSteps: number;
  wanderTemperature: number;
  searchProvider: string;
  searchApiKey: string;
  exaApiKey: string;
  maxSearchResults: number;
  outputLanguage: string;
  feishuWebhook?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  larkAppId?: string;
  larkAppSecret?: string;
  feishu?: { pushMode; receiveMode; chatId? };
  urlCooldownDays: number;
  generateTextMaxRetries: number;
  consolidation?: { lowImportanceThreshold; expiryDays; mergeMaxAgeDays; urlCleanupDays };
  interests?: { decayLambda; maxWeight; minInterestCount; noveltyBudget; defaultSeeds; minWeight };
  pushGate?: { enabled; threshold; weights; calibration; contentScan };
}
```

---

## 6. Directory Structure

```
packages/agent/src/tools/
├── tool-manager.ts          # ToolManager class + ToolDefinition/ToolMetadata interfaces
├── tool-prompt.ts           # CATEGORY_NAMES, CATEGORY_ORDER, buildToolsDescription()
├── registry/
│   ├── index.ts             # Re-exports ToolManager + types
│   ├── auto-register.ts     # TOOL_DEFINITIONS array + registerAllTools()
│   ├── context.ts           # ToolContext interface + pushWanderStep()
│   ├── _template.ts         # Old-style template (not ToolDefinition pattern)
│   ├── search-web.ts        # category: 'search'
│   ├── read-page.ts         # category: 'web'
│   ├── speak.ts             # category: 'content'
│   ├── rest.ts              # category: 'content'
│   ├── record-knowledge.ts  # category: 'memory'
│   ├── observe-user.ts      # category: 'memory'
│   └── read-feedback.ts     # category: 'feedback' (exports 2 tools)
├── dedup/
│   └── url-tracker.ts       # URL dedup/cooldown
├── page/
│   └── reader.ts            # Page reading implementation
├── push/
│   ├── speak.ts             # Push implementation
│   ├── feishu-card.ts
│   └── lark-sender.ts
├── search/
│   ├── index.ts             # search(), premiumSearch()
│   ├── adapter.ts
│   ├── duckduckgo.ts
│   ├── tavily.ts
│   └── exa.ts
└── feishu/
    └── ws-client.ts
```

---

## 7. Key Dependencies

- **`ai`** (Vercel AI SDK) — `tool()` function, `Tool` type
- **`zod`** — schema validation for tool inputs
- **`consola`** — structured logging with tags

---

## 8. Summary: Adding a Browser Tool

To add browser tools (e.g. `browser_navigate`, `browser_click`, `browser_screenshot`):

1. **New category:** Add `'browser'` to `ToolMetadata.category` union in `tool-manager.ts`
2. **Prompt display:** Add `browser: '浏览器操作'` to `CATEGORY_NAMES` and `'browser'` to `CATEGORY_ORDER` in `tool-prompt.ts`
3. **Tool files:** Create `packages/agent/src/tools/registry/browser-navigate.ts` etc., each exporting `ToolDefinition`
4. **Register:** Import and add to `TOOL_DEFINITIONS` in `auto-register.ts`
5. **Config:** If browser needs config (e.g. headless mode, viewport), add to `AgentConfig` + `BehaviorConfig` + `defaultBehavior`
6. **Implementation:** Put browser engine logic in `packages/agent/src/tools/browser/` (parallel to `search/`, `page/`, `push/`)
