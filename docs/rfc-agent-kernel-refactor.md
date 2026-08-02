# RFC: Agent 内核重构

> Issue: #59 | 状态: DRAFT | 日期: 2026-08-02

## 1. 问题陈述

当前 agent 内核是单层 `runAgentLoop()` 直接调用 AI SDK `generateText()`。7 个结构性痛点（见 #59）。核心矛盾：工程壳子 B+，灵魂 C——进化机制存在但不驱动行为，状态系统存在但不影响行为。

## 2. 设计原则

- **参考 Pi，不移植 Pi**。Pi 是交互式 agent，我们是自主 agent。学模式不学代码。
- **功能 + 可扩展性**评估，不是"现状够不够用"。
- **每条设计有理由**：不用会怎样，用了好处是什么。
- **核心价值不可妥协**：闭环自进化（兴趣进化 + 主动推送）。

## 3. 架构：三层 + 事件协议

```
┌─────────────────────────────────────────────────────────┐
│ StrayHarness（编排层）                                    │
│ 心跳调度 · 反思触发 · 持久化 · 信号处理 · 多agent编排      │
│ 订阅 Agent 事件 → 写记忆/状态/历史                        │
└────────────────────────┬────────────────────────────────┘
                         │ events (subscribe)
                         │ config, state, hooks (inject)
┌────────────────────────▼────────────────────────────────┐
│ WanderAgent（状态层）                                     │
│ 持有 AgentState · InterestGraph · UserProfile            │
│ 归约事件 → 更新状态                                       │
│ 生成游荡策略（兴趣→约束，状态→参数）                       │
│ 多 agent 时：协调多个 loop 实例                           │
└────────────────────────┬────────────────────────────────┘
                         │ events (emit)
                         │ strategy, tools, hooks (params)
┌────────────────────────▼────────────────────────────────┐
│ wanderLoop（纯函数层）                                    │
│ 给定 strategy + tools + hooks → 跑一轮游荡               │
│ 不 import 任何单例，不持有状态                             │
│ 每步 emit 结构化事件                                     │
│ 返回 WanderResult                                       │
└─────────────────────────────────────────────────────────┘
```

### 为什么三层

| 层 | 不用会怎样 | 用了好处 |
|----|-----------|---------|
| wanderLoop 纯函数 | 想测"给定这个策略和工具，LLM 会怎么走"必须 mock 整个系统 | 可独立测试、可替换 LLM 后端、可并行跑多个 loop |
| WanderAgent 状态层 | 状态更新散落在 runAgentLoop 后处理里，多 agent 时无法协调 | 状态归约集中、多 agent 协作的协调点、策略生成可测试 |
| StrayHarness 编排层 | 心跳、反思、持久化、信号处理全在 index.ts 300 行里 | 编排逻辑可替换（CLI/TUI/daemon）、持久化策略可换 |

### 事件协议

```ts
type WanderEvent =
  // 生命周期
  | { type: 'wander_start'; traceId: string; strategy: WanderStrategy }
  | { type: 'wander_end'; result: WanderResult }
  // 步级
  | { type: 'step_start'; step: number }
  | { type: 'step_end'; step: number; action: string }
  // 工具
  | { type: 'tool_call_start'; tool: string; params: unknown }
  | { type: 'tool_call_end'; tool: string; success: boolean; durationMs: number; error?: string }
  // 行为
  | { type: 'speak'; content: string; speakType: string; gated: boolean; score?: number }
  | { type: 'interest_signal'; topic: string; signal: 'positive' | 'negative' | 'neutral' }
  // 错误
  | { type: 'error'; phase: string; error: string; recoverable: boolean }
```

**事件不是日志。** 它是：
- Agent 层的状态转移输入（归约）
- Harness 层的持久化触发（write-ahead）
- 扩展/hook 的反应表面
- 未来多 agent 的协调信号（跨进程时需可序列化——当前设计已满足：纯数据对象，无闭包）
- TUI/Web 的实时数据源（如果需要）

日志（consola）降级为事件的一个 subscriber，不再是散落的 side-effect。

### 事件实现

使用 typed EventEmitter（Node 原生 `EventEmitter` + 泛型约束）。

理由：
- 同进程场景够用，零依赖
- 事件是纯数据对象（可 JSON 序列化），未来跨进程只需加一层 transport（WebSocket/IPC），不改事件定义
- 不用 Pi 的 EventStream（AsyncIterable + push）——那是为 streaming 渲染 + 跨进程传输设计的，我们当前不需要背压控制

## 4. Hook 系统

### 为什么通用 hook 而不是硬编码检查

不用：每加一个规则改一个工具。speak 里硬编码 PushGate，read_page 里硬编码 cooldown。规则不可组合、不可独立测试、不可动态启用/禁用。

用了：规则集中注册、可组合、可测试、可按配置启用。新规则 = 新 hook 文件，不改工具代码。

### 设计

```ts
interface HookDefinition {
  name: string;
  priority: number;  // 执行顺序，数字小的先执行
  
  // 工具执行前：可拦截、可修改参数
  beforeToolCall?(ctx: HookContext, tool: string, params: unknown):
    Promise<{ action: 'allow' } | { action: 'deny'; reason: string } | { action: 'modify'; params: unknown }>;
  
  // 工具执行后：可修改结果、可触发副作用
  afterToolCall?(ctx: HookContext, tool: string, params: unknown, result: unknown):
    Promise<{ result: unknown } | { result: unknown; addedEvents?: WanderEvent[] }>;
  
  // 游荡生命周期
  onWanderStart?(ctx: HookContext, strategy: WanderStrategy): Promise<void>;
  onWanderEnd?(ctx: HookContext, result: WanderResult): Promise<void>;
  onStepEnd?(ctx: HookContext, step: number, action: string): Promise<void>;
}

interface HookContext {
  traceId: string;
  state: Readonly<AgentState>;
  config: Readonly<AgentConfig>;
  emit(event: WanderEvent): void;  // hook 可以发事件
}
```

### 注册方式：目录扫描自动发现

```
packages/agent/src/hooks/
├── index.ts              ← 扫描本目录，按 priority 排序，导出 hook 链
├── security.ts           ← SecurityHook
├── budget.ts             ← BudgetHook
├── dedup.ts              ← DedupHook
└── quality.ts            ← QualityHook
```

- 每个文件 export default 一个 `HookDefinition`
- `index.ts` 用 `import.meta.glob`（或 readdir + dynamic import）扫描同目录
- 配置文件 `agent-config.json` 可禁用特定 hook（`hooks.disabled: ["quality"]`）
- 未来 browser 模块在自己的目录放 hook 文件，主扫描路径加上即可

### 内置 hooks（首批）

| Hook | 职责 | 对应 issue |
|------|------|-----------|
| SecurityHook | UNTRUSTED 标记注入、域名白名单 | #49, #53 |
| BudgetHook | token/步数预算追踪，超限强制 rest | #48 |
| DedupHook | URL 冷却期、话题去重 | #27 |
| QualityHook | speak 内容质量下限 | 新增 |

## 5. 兴趣驱动行为

### 为什么

核心价值。不用：兴趣进化是假的——权重变了，行为没变。用了：闭环成立。

### 方向（具体实现后续讨论）

- 兴趣 → 结构化约束（不是自由文本 prompt）
- 硬约束：top-1 兴趣必须出现在游荡策略中
- 软约束：prompt 结构化注入"本次建议方向"
- 放弃信号：连续无收获时注入"换方向"提示

### WanderStrategy（Agent 层生成，传给 loop）

```ts
interface WanderStrategy {
  focusTopics: string[];          // 本次游荡聚焦话题（从兴趣图谱生成）
  explorationMode: 'deep' | 'broad' | 'novel';  // 深挖/广撒/探索新领域
  maxSteps: number;               // 受精力影响
  speakInclination: 'high' | 'normal' | 'low';  // 受心情/无聊影响
  constraints: string[];          // 硬约束列表（注入 prompt）
}
```

## 6. 状态→行为映射

| 状态 | 映射 | 形态 |
|------|------|------|
| 精力 > 70 | maxSteps=12, explorationMode 不限 | 硬参数 |
| 精力 30-70 | maxSteps=8 | 硬参数 |
| 精力 < 30 | maxSteps=4, explorationMode='deep'（不探索新的） | 硬参数 |
| 无聊 > 80 | explorationMode='novel' | 硬参数 |
| 无聊 40-80 | explorationMode='broad' | 硬参数 |
| 无聊 < 40 | explorationMode='deep' | 硬参数 |
| 心情 | speakInclination + prompt 风格提示 | 软提示 |

## 7. Mid-wander 提示（记录，暂不实现）

规则引擎注入 user prompt：
- 连续 3 步无 read → "选一个链接点进去"
- 60% 步数用完 0 speak → "有想分享的吗"
- 同域名 3 次 → "继续还是换方向"

目前没遇到实际问题，后续观察再决定是否实现。

## 8. LLM 调用

继续使用 AI SDK `generateText` + `stopWhen` + tool calling。

理由：
- 当前只用 DeepSeek 一个 provider，AI SDK 的抽象够用
- tool calling schema 校验、stopWhen 条件、onStepFinish 回调都是现成的
- 自己管 stream 是过度工程——除非未来需要多 provider 热切换

如果未来需要多 provider：在 WanderAgent 层加一个 `resolveModel()` 即可，不需要改 loop。

## 9. 多 agent 协作（延后）

当前设计对多 agent 的影响：

- **不影响现阶段**。只要：(1) 事件是纯数据可序列化；(2) Agent 层不假设"全局只有一个 agent"；(3) wanderLoop 是纯函数可并行实例化。这三条当前设计已满足。
- 具体协作形态（orchestrator + specialists？多宠物并行？）待想清楚后另开 issue。
- 跨进程时事件加一层 transport（IPC/WebSocket），不改事件定义和 loop/Agent 接口。

## 10. 非目标

- 不移植 Pi 代码
- 不改记忆层 Markdown 格式
- 不改推送渠道
- 不改 Web 仪表盘只读契约
- 不涉及多用户/SaaS
- 不实现 mid-wander reflection（记录待观察）
- 不实现多 agent 协作（设计兼容，实现延后）

## 11. 迁移策略

增量重构，不一次性重写：

1. **Phase 1**：拆出 wanderLoop 纯函数 + 事件 emit（从 runAgentLoop 提取）
2. **Phase 2**：引入 hook 系统 + 迁移现有硬编码检查（PushGate、cooldown）
3. **Phase 3**：引入 WanderAgent 状态层 + WanderStrategy 生成
4. **Phase 4**：兴趣驱动行为（strategy 消费 InterestGraph）
5. **Phase 5**：状态→行为硬映射
6. **Phase 6**：StrayHarness 编排层（从 index.ts 提取）

每个 Phase 独立可交付、独立可测试。旧代码在新层稳定后删除。
