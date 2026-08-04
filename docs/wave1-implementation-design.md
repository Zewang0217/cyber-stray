# Wave 1 实现设计：结构重构

> Issue: #60 | 前置: #59 RFC | 约束: 行为完全不变

> ⚠️ **实现漂移说明（2026-08-04，PR #65 review 后）**：本文档是 Wave 1 时的设计快照，与最终实现有以下差异：
> - hook 注册方式：目录扫描已放弃（生产态只扫到 .js 会加载 0 个 hook），改为 `hooks/register.ts` 静态注册 + fail-fast
> - `step_start` 事件已删除（无稳定 emit 点）；`step_end`/`speak` 事件已补全 emit
> - `buildStrategy` 不再是硬编码——Wave 2 已注入兴趣驱动 + 状态映射（见 `core/strategy.ts`）
> - DATA_DIR 相关路径全部改为调用时懒解析（禁 import 期冻结）

## 目标文件结构

```
packages/agent/src/
├── core/                          ← 新增：三层 + 事件
│   ├── events.ts                  ← WanderEvent 类型 + typed emitter
│   ├── wander-loop.ts             ← 纯函数：跑游荡
│   ├── wander-agent.ts            ← 状态层：归约事件、生成策略
│   └── stray-harness.ts           ← 编排层：心跳、反思、持久化、信号
├── hooks/                         ← 新增：hook 系统
│   ├── types.ts                   ← HookDefinition 接口
│   ├── loader.ts                  ← 目录扫描 + priority 排序
│   ├── chain.ts                   ← 执行链（串行调用 hooks）
│   ├── security.ts                ← UNTRUSTED 标记（预留，Wave 1 只建骨架）
│   ├── budget.ts                  ← 步数/token 预算（迁移 maxSteps 逻辑）
│   ├── dedup.ts                   ← URL 冷却期（从 read-page.ts 迁出）
│   └── quality.ts                 ← speak 门控（从 speak.ts 迁出 PushGate）
├── agent/
│   ├── react.ts                   ← 删除（逻辑迁入 core/wander-loop.ts）
│   ├── state.ts                   ← 保留不动
│   └── state.test.ts              ← 保留不动
├── tools/
│   ├── tool-manager.ts            ← 改造：getTools 接受 hook chain 包装
│   ├── registry/
│   │   ├── context.ts             ← 保留，ToolContext 不变
│   │   ├── speak.ts               ← 删除内部 PushGate 硬编码（迁到 hook）
│   │   ├── read-page.ts           ← 删除内部 cooldown 硬编码（迁到 hook）
│   │   └── ...                    ← 其余工具不动
│   └── ...
├── index.ts                       ← 瘦身为 ~30 行：创建 Harness，调 start()
└── ...
```

## 1. 事件协议 (`core/events.ts`)

```ts
import { EventEmitter } from 'node:events';

// ─── 事件类型 ───

export type WanderEvent =
  | { type: 'wander_start'; traceId: string; maxSteps: number }
  | { type: 'wander_end'; result: WanderResult }
  | { type: 'step_start'; step: number }
  | { type: 'step_end'; step: number; action: string }
  | { type: 'tool_call_start'; tool: string; params: unknown }
  | { type: 'tool_call_end'; tool: string; success: boolean; durationMs: number; error?: string }
  | { type: 'speak'; content: string; speakType: string; gated: boolean; score?: number }
  | { type: 'error'; phase: string; error: string; recoverable: boolean };

// ─── Typed Emitter ───

export interface WanderEventMap {
  event: [WanderEvent];  // 统一通道，按 event.type 分发
}

export class WanderEventEmitter extends EventEmitter<WanderEventMap> {
  emitEvent(event: WanderEvent): void {
    this.emit('event', event);
  }
}

export type EmitFn = (event: WanderEvent) => void;
```

**设计决策：**
- 统一 `'event'` 通道而非 per-type 通道。理由：subscriber 通常想 switch(event.type) 自己过滤，per-type 通道导致注册 N 个 listener。
- `EmitFn` 是传给 wanderLoop 的——loop 不持有 emitter 实例，只拿到一个函数。保持纯。

## 2. wanderLoop 纯函数 (`core/wander-loop.ts`)

**签名：**

```ts
export interface WanderLoopConfig {
  maxSteps: number;
  temperature: number;
  llmModel: string;
  generateTextMaxRetries: number;
  energyCostPerStep: number;
  boredomReductionPerStep: number;
}

export interface WanderLoopInput {
  state: AgentState;
  config: WanderLoopConfig;
  systemPrompt: string;
  userPrompt: string;
  tools: Record<string, Tool>;       // AI SDK Tool 对象（已被 hook 包装）
  emit: EmitFn;
}

export async function wanderLoop(input: WanderLoopInput): Promise<WanderResult>
```

**从 `runAgentLoop` 迁移什么：**
- LLM 调用（generateText + stopWhen + onStepFinish）→ 保留
- 重试逻辑 → 保留
- 事件 emit → 新增（在关键节点调 `input.emit()`）
- 后处理（recordWanderSummary、appendWanderHistory、updateState）→ **移出**，归 WanderAgent

**不 import 什么：**
- ❌ `config`（由参数注入）
- ❌ `getDataPath`（后处理不在这里）
- ❌ `loadUserProfile`（prompt 构建不在这里）
- ❌ `buildMemoryPromptContext`（同上）
- ❌ `updateState`（同上）
- ❌ `ToolManager`（tools 由参数传入）

**保留什么：**
- `generateText` from 'ai'（LLM 调用）
- `createDeepSeek`（provider 创建——或者也注入？Wave 1 先保留，Wave 2 考虑）
- `WanderResult` 类型
- LLM stats 记录（`recordStep`）——这是观测，不是状态，保留在 loop 内

## 3. WanderAgent 状态层 (`core/wander-agent.ts`)

```ts
export class WanderAgent {
  private emitter: WanderEventEmitter;
  private hookChain: HookChain;

  constructor(private deps: {
    config: AgentConfig;
    // 未来：interestGraph, userProfile 等
  }) {
    this.emitter = new WanderEventEmitter();
    this.hookChain = new HookChain();  // 由 loader 填充
  }

  /** 订阅事件（Harness、TUI、日志用） */
  onEvent(listener: (event: WanderEvent) => void): () => void { ... }

  /** 执行一次游荡 */
  async wander(state: AgentState): Promise<WanderResult> {
    // 1. 生成策略（Wave 1：硬编码当前值）
    const strategy = this.buildStrategy(state);

    // 2. 构建 prompt（从 prompts/react.ts 调用）
    const userProfile = await loadUserProfile();
    const memoryContext = await buildMemoryPromptContext();
    const systemPrompt = buildReactSystemPrompt(state, userProfile, memoryContext);
    const userPrompt = buildReactUserPrompt({ ... });

    // 3. 获取工具（经 hook 包装）
    const ctx = this.createToolContext(state);
    const rawTools = ToolManager.getTools(ctx);
    const tools = this.hookChain.wrapTools(rawTools, ctx);

    // 4. 调 wanderLoop
    const result = await wanderLoop({
      state,
      config: { maxSteps: strategy.maxSteps, ... },
      systemPrompt,
      userPrompt,
      tools,
      emit: (e) => this.emitter.emitEvent(e),
    });

    // 5. 后处理（从 runAgentLoop 迁来）
    await this.postWander(state, result, ctx);

    return result;
  }

  /** Wave 1：硬编码，行为不变 */
  private buildStrategy(state: AgentState): WanderStrategy {
    return {
      focusTopics: [],
      explorationMode: 'broad',
      maxSteps: this.deps.config.maxWanderSteps,  // 当前值
      speakInclination: 'normal',
      constraints: [],
    };
  }

  /** 后处理：记记忆、写历史、更新状态 */
  private async postWander(state: AgentState, result: WanderResult, ctx: ToolContext): Promise<void> {
    // 迁移自 runAgentLoop 268-295 行
    await recordWanderSummary(...);
    await appendWanderHistory(ctx.wanderHistory);
    await updateState({ ... });
  }
}
```

## 4. StrayHarness 编排层 (`core/stray-harness.ts`)

```ts
export class StrayHarness {
  private agent: WanderAgent;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private shuttingDown = false;

  constructor() {
    this.agent = new WanderAgent({ config });
    // 订阅事件 → 日志
    this.agent.onEvent(logEventSubscriber);
  }

  async start(): Promise<void> {
    // 迁移自 index.ts main()：
    // validateConfig → initFeishuWS → loadState → initInterestGraph
    // → runStartupMemoryMaintenance → initReflectionScheduler
    // → registerSignalHandlers → startHeartbeat
  }

  async stop(): Promise<void> {
    // 迁移自 registerSignalHandlers 的关闭逻辑
  }

  private async runHeartbeat(): Promise<void> {
    // 迁移自 index.ts runHeartbeat()
    // 调 this.agent.wander(state) 替代 runAgentLoop(state)
  }
}
```

## 5. Hook 系统

### types.ts

```ts
export interface HookContext {
  traceId: string;
  state: Readonly<AgentState>;
  config: Readonly<AgentConfig>;
  emit: EmitFn;
}

export type BeforeResult =
  | { action: 'allow' }
  | { action: 'deny'; reason: string }
  | { action: 'modify'; params: unknown };

export interface HookDefinition {
  name: string;
  priority: number;

  beforeToolCall?(ctx: HookContext, tool: string, params: unknown): Promise<BeforeResult>;
  afterToolCall?(ctx: HookContext, tool: string, params: unknown, result: unknown): Promise<{ result: unknown }>;
  onWanderStart?(ctx: HookContext): Promise<void>;
  onWanderEnd?(ctx: HookContext, result: WanderResult): Promise<void>;
}
```

### loader.ts

```ts
/**
 * 扫描 hooks/ 目录，加载所有 export default HookDefinition 的文件
 * 按 priority 升序排列
 * 配置文件可禁用特定 hook
 */
export async function loadHooks(disabledNames?: string[]): Promise<HookDefinition[]> {
  const dir = new URL('.', import.meta.url);
  const files = readdirSync(dir).filter(f =>
    f.endsWith('.ts') && !['types.ts', 'loader.ts', 'chain.ts', 'index.ts'].includes(f)
  );
  const hooks: HookDefinition[] = [];
  for (const file of files) {
    const mod = await import(`./${file}`);
    if (mod.default?.name) hooks.push(mod.default);
  }
  return hooks
    .filter(h => !disabledNames?.includes(h.name))
    .sort((a, b) => a.priority - b.priority);
}
```

### chain.ts

```ts
export class HookChain {
  private hooks: HookDefinition[] = [];

  async init(disabledNames?: string[]): Promise<void> {
    this.hooks = await loadHooks(disabledNames);
  }

  /** 包装 AI SDK tools，在 execute 前后插入 hook 调用 */
  wrapTools(tools: Record<string, Tool>, hookCtx: HookContext): Record<string, Tool> {
    const wrapped: Record<string, Tool> = {};
    for (const [name, tool] of Object.entries(tools)) {
      wrapped[name] = this.wrapTool(name, tool, hookCtx);
    }
    return wrapped;
  }

  private wrapTool(name: string, tool: Tool, hookCtx: HookContext): Tool {
    const originalExecute = tool.execute;
    return {
      ...tool,
      execute: async (params, options) => {
        // beforeToolCall
        for (const hook of this.hooks) {
          if (!hook.beforeToolCall) continue;
          const result = await hook.beforeToolCall(hookCtx, name, params);
          if (result.action === 'deny') {
            return { error: `Blocked by ${hook.name}: ${result.reason}` };
          }
          if (result.action === 'modify') {
            params = result.params;
          }
        }

        // 执行原始工具
        const start = Date.now();
        hookCtx.emit({ type: 'tool_call_start', tool: name, params });
        let result: unknown;
        let success = true;
        try {
          result = await originalExecute(params, options);
        } catch (err) {
          success = false;
          result = { error: String(err) };
        }
        hookCtx.emit({ type: 'tool_call_end', tool: name, success, durationMs: Date.now() - start });

        // afterToolCall
        for (const hook of this.hooks) {
          if (!hook.afterToolCall) continue;
          const modified = await hook.afterToolCall(hookCtx, name, params, result);
          result = modified.result;
        }

        return result;
      },
    };
  }
}
```

### 首批 hooks

**quality.ts**（迁移 PushGate）：
```ts
export default {
  name: 'quality',
  priority: 100,
  async afterToolCall(ctx, tool, params, result) {
    if (tool !== 'speak') return { result };
    // 迁移 speak.ts 48-88 行的 PushGate 逻辑
    // gated → 修改 result.pushed = false
    return { result };
  },
} satisfies HookDefinition;
```

**dedup.ts**（迁移 URL cooldown）：
```ts
export default {
  name: 'dedup',
  priority: 50,
  async beforeToolCall(ctx, tool, params) {
    if (tool !== 'read_page') return { action: 'allow' };
    // 迁移 read-page.ts 37-39 行的 cooldown 检查
    // 在冷却期 → 不 deny，但注入提示（保持当前行为：仍然读取，返回时附加 visited 信息）
    return { action: 'allow' };
  },
  async afterToolCall(ctx, tool, params, result) {
    if (tool !== 'read_page') return { result };
    // 迁移 read-page.ts 58-66 行的冷却期提示逻辑
    return { result };
  },
} satisfies HookDefinition;
```

**budget.ts**（迁移 maxSteps + energy 检查）：
```ts
export default {
  name: 'budget',
  priority: 10,
  async beforeToolCall(ctx, tool, params) {
    // 迁移 read-page.ts 31-35 行的精力检查
    if (tool === 'read_page' && ctx.state.energy < ctx.config.energyThreshold) {
      return { action: 'deny', reason: '精力不足' };
    }
    return { action: 'allow' };
  },
} satisfies HookDefinition;
```

**security.ts**（Wave 1 只建骨架，不实现）：
```ts
export default {
  name: 'security',
  priority: 1,
  // Wave 2 或独立 issue 实现 UNTRUSTED 标记、域名白名单
} satisfies HookDefinition;
```

## 6. index.ts 瘦身

```ts
import { StrayHarness } from './core/stray-harness.js';

const harness = new StrayHarness();
harness.start().catch((error) => {
  console.error('启动失败', error);
  process.exit(1);
});
```

~10 行。所有编排逻辑在 StrayHarness 内。

## 7. 迁移清单（行为不变验证）

| 原位置 | 迁移到 | 行为变化 |
|--------|--------|---------|
| `react.ts` runAgentLoop LLM 调用 | `core/wander-loop.ts` | 无 |
| `react.ts` 后处理（记忆/历史/状态） | `core/wander-agent.ts` postWander | 无 |
| `react.ts` extractRecentTopics | `core/wander-agent.ts` | 无 |
| `react.ts` appendWanderHistory | `core/wander-agent.ts` | 无 |
| `index.ts` main() | `core/stray-harness.ts` start() | 无 |
| `index.ts` runHeartbeat() | `core/stray-harness.ts` | 无 |
| `index.ts` registerSignalHandlers() | `core/stray-harness.ts` stop() | 无 |
| `index.ts` runStartupMemoryMaintenance() | `core/stray-harness.ts` | 无 |
| `speak.ts` PushGate 调用 | `hooks/quality.ts` | 无（逻辑相同，位置变了） |
| `read-page.ts` cooldown 检查 | `hooks/dedup.ts` | 无 |
| `read-page.ts` energy 检查 | `hooks/budget.ts` | 无 |
| `react.ts` _resetReactModuleState | 删除（不再需要模块级单例） | 测试改用实例隔离 |

## 8. 测试策略

- 现有测试（`react.test.ts`, `state.test.ts`, `push-gate.test.ts` 等）必须全过
- `react.test.ts` 需要适配：从调 `runAgentLoop` 改为调 `WanderAgent.wander()`
- 新增：`hooks/chain.test.ts`（hook 链执行顺序、deny/modify 行为）
- 新增：`core/wander-loop.test.ts`（mock LLM，验证事件序列）

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| AI SDK Tool 包装后 schema 丢失 | wrapTool 保留原始 tool 的所有属性（spread） |
| hook 内抛错阻断游荡 | chain.ts 每个 hook 调用包 try/catch，失败 → warn + allow |
| 事件 emit 性能 | 同步 emit，无 async（subscriber 自己管 async） |
| 旧代码删除后遗漏引用 | typecheck + lint 兜底 |
