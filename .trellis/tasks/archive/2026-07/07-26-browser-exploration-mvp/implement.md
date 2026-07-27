# 浏览器探索模块 MVP — 执行计划

## 实现顺序

```
Phase 1 (并行，无依赖)
├── Module 1: agent-browser 基础设施  → 07-26-m1-browser-infra
└── Module 4: Skill 文件系统          → 07-26-m4-skill-filesystem

Phase 2 (顺序，依赖 Phase 1)
├── Module 2: 浏览器操作工具集        → 07-26-m2-browser-tools  (依赖 M1)
└── Module 3: 浏览器守护进程生命周期  → 07-26-m3-browser-lifecycle (依赖 M1+M2)
```

## Phase 1a: Module 1 — agent-browser 基础设施

子任务：`07-26-m1-browser-infra`

- [ ] 1. 创建 `packages/agent/src/tools/browser/types.ts`
  - `AgentBrowserEnvelope`、`BrowserCommandResult` 接口
- [ ] 2. 创建 `packages/agent/src/tools/browser/executor.ts`
  - `BrowserExecutor` 类：spawn 异步、AbortController 超时、JSON 解析
  - `getBrowserExecutor()` 单例工厂
  - `warmUp()`、`shutdown()`、`isAvailable()` 方法
- [ ] 3. 创建 `packages/agent/src/tools/browser/executor.test.ts`
  - mock `child_process.spawn`
  - 测试：正常执行、超时、CLI 不存在、JSON 解析错误、非零退出码
- [ ] 4. 创建 `scripts/setup-agent-browser.ts`
  - 检查/安装 agent-browser、执行 `agent-browser install`、`doctor` 验证
- [ ] 5. 根 `package.json` 添加 `"setup:browser"` 脚本
- [ ] 6. 验证：`pnpm --filter @cyber-stray/agent test -- src/tools/browser/executor.test.ts`

## Phase 1b: Module 4 — Skill 文件系统

子任务：`07-26-m4-skill-filesystem`

- [ ] 1. 创建 `packages/agent/src/tools/browser/skills/parser.ts`
  - YAML frontmatter 解析（手写正则，不引入 yaml 依赖）
  - `parseSkillFile()` 函数
- [ ] 2. 创建 `packages/agent/src/tools/browser/skills/parser.test.ts`
- [ ] 3. 创建 `packages/agent/src/tools/browser/skills/skill-index.ts`
  - `SkillIndex` 类：scan / list / load / create / patch / has
  - 使用 `getDataPath('skills')` 定位目录
- [ ] 4. 创建 `packages/agent/src/tools/browser/skills/skill-index.test.ts`
  - 使用 `useTempDataDir()` 隔离
- [ ] 5. 创建 skill 工具文件（3 个 ToolDefinition）
  - `tool-list.ts`：`browser_skill_list`
  - `tool-load.ts`：`browser_skill_load`
  - `tool-create.ts`：`browser_skill_create`（含硬校验）
- [ ] 6. 创建 `packages/agent/src/tools/browser/skills/index.ts`（barrel export）
- [ ] 7. 在 `auto-register.ts` 注册 3 个 skill 工具
- [ ] 8. 在 `tool-manager.ts` category 联合类型增加 `'browser'`
- [ ] 9. 在 `tool-prompt.ts` 增加 browser 分类
- [ ] 10. 验证：`pnpm --filter @cyber-stray/agent test -- src/tools/browser/skills/`

## Phase 2a: Module 2 — 浏览器操作工具集

子任务：`07-26-m2-browser-tools`（依赖 M1 完成）

- [ ] 1. 创建 `packages/agent/src/tools/browser/tools/browse-page.ts`
  - `browsePageToolDef: ToolDefinition`
  - 执行 `open <url>` → `read` → 合并结果
- [ ] 2. 创建 `packages/agent/src/tools/browser/tools/browse-snapshot.ts`
  - `browseSnapshotToolDef: ToolDefinition`
  - 执行 `snapshot -i` → 返回可交互元素结构
- [ ] 3. 创建 `packages/agent/src/tools/browser/tools/browse-act.ts`
  - `browseActToolDef: ToolDefinition`
  - action 枚举分发到对应 CLI 命令
- [ ] 4. 创建 `packages/agent/src/tools/browser/tools/index.ts`（barrel export）
- [ ] 5. 在 `auto-register.ts` 注册 3 个浏览器工具（条件注册：browser.enabled）
- [ ] 6. 更新 `ToolContext`：增加 `browserContext?: BrowserContext`
- [ ] 7. 编写单元测试（mock BrowserExecutor）
- [ ] 8. 验证：`pnpm --filter @cyber-stray/agent test -- src/tools/browser/tools/`

## Phase 2b: Module 3 — 浏览器守护进程生命周期

子任务：`07-26-m3-browser-lifecycle`（依赖 M1 + M2 完成）

- [ ] 1. 创建 `packages/agent/src/tools/browser/lifecycle.ts`
  - `BrowserContext` 接口
  - `browserWarmUp()`、`browserShutdown()`、`buildBrowserPromptSection()`
  - `updateBrowserContext()` — 工具执行后更新上下文
- [ ] 2. 修改 `packages/agent/src/types.ts`
  - `AgentConfig` 增加 `browser?` 嵌套对象
- [ ] 3. 修改 `packages/agent/src/config.ts`
  - `defaultBehavior` 增加 browser 默认值
  - `loadBehaviorConfig()` 增加字段级合并
- [ ] 4. 修改 `packages/agent/src/index.ts`
  - main() 中集成 `browserWarmUp()`（initFeishuWS 之后）
  - `registerSignalHandlers()` 中集成 `browserShutdown()`
- [ ] 5. 修改 `packages/agent/src/agent/react.ts`
  - ToolContext 构建时注入 browserContext
  - system prompt 追加浏览器上下文段
- [ ] 6. 修改浏览器工具：执行后调用 `updateBrowserContext()`
- [ ] 7. 编写 lifecycle 单元测试
- [ ] 8. 全量验证：`pnpm test && pnpm lint && pnpm typecheck`

## 最终验证

- [ ] `pnpm test` — 所有测试通过（含新增）
- [ ] `pnpm lint` — 无新 lint 错误
- [ ] `pnpm typecheck` — 类型检查通过
- [ ] 手动冒烟：`pnpm setup:browser` → 启动 agent → 浏览器工具可用

## 回滚点

- Phase 1 完成后：可独立验证 M1 和 M4，不影响现有功能
- Phase 2a 完成后：浏览器工具已注册但无生命周期管理，可独立使用
- Phase 2b 完成后：完整 MVP，回滚需按逆序移除
