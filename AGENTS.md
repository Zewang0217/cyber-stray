# cyber-stray AGENTS.md

> 本仓库的 agent 规范与入口，**唯一真相源**：硬约定、契约、Git 流程都写在这里。与全局 `~/.agents/AGENTS.md` 冲突时以本文件为准。

**项目本质**：自进化赛博宠物——被自己不断进化的好奇心驱动去探索和学习，并主动推送主人会感兴趣的内容。宠物是产品本体：活着的、有脾气的、看得见的，不是信息流的隐喻层。

**主轴（不可妥协）**：兴趣会进化 + 能主动推主人感兴趣的内容，闭环 = `探索 → 学习 → 反思 → 进化兴趣 → 更懂主人 → 更准推送`。推送渠道 / 仪表盘 / 搜索源都可以失败或替换；做取舍时，把「兴趣进化 + 准确推送」这条闭环当成不可牺牲的优先级。

## 架构

pnpm monorepo（TypeScript strict）：`packages/agent`（宠物运行时，tsx）、`packages/control-plane`（后端：鉴权 / 计费 / 调度 / API）、`packages/web`（Next.js 16 只读仪表盘）、`packages/site`（官网落地页，Next 静态导出 + nginx）、`packages/shared`（跨包契约）、`packages/slides`（Slidev）。宠物不是常驻进程：后端调度器按「无聊 / 精力就绪」拉起短命 worker（`packages/agent/src/worker/run-one-wander.ts`），跑一小段游荡后写回退出。

agent 内核（`packages/agent/src/`）= 三层 + hook：

- `index.ts` → `core/stray-harness.ts`（编排：心跳 / 反思触发 / 持久化 / 信号）→ `core/wander-agent.ts`（状态层：归约 `core/events.ts` 事件）→ `core/wander-loop.ts`（纯函数：一轮游荡，AI SDK v6 `generateText` + `stopWhen`）。`core/strategy.ts` 同为纯函数（`AgentState` + 注入 `focusTopics` → `WanderStrategy`）。
- `hooks/`：`register.ts` **静态注册** dedup / quality / security，`chain.ts` 包装工具 `execute` 按 priority 串行调用（deny 短路；hook 抛错只 warn 不阻断游荡）。目录扫描方案已废弃——编译部署后只扫到 `.js`，会 0 hook 加载、守卫静默消失。
- `memory/`：`long-term/`（`MemoryStore` + `MemoryIndex`）、`reflection/`（engine + scheduler）、`user-profile.ts`、`interest-graph.ts`（主人兴趣）+ `curiosity-interests.ts`（宠物好奇）+ `interest-history.ts`、`feedback-pipeline.ts` / `feedback-store.ts`、`alleys.ts`（巷子清单，工具填 alley 与 prompt 注入共用）、`diary/`、`push-gate.ts`（**遗留名**：只做内容扫描 + 话题归因，不再评分拦截，ADR-0010）。
- `tools/`：语义级工具，`registry/auto-register.ts` 静态注册；`search/` 三家（DuckDuckGo / Tavily / Exa）统一 `SearchAdapter`。

## 已锁定决策（勿擅改）

- **Tech stack**：Node/tsx + AI SDK v6 + DeepSeek + 文件系统持久化；宠物记忆保留人类可读 Markdown，**不整体迁 SQLite**（后端元数据是另一层：SQLite + Drizzle）。
- **Architecture**：统一游荡 + 推送门控（不做学习 / 服务双模式分离）；兴趣进化 = 反思 + 反馈双驱动；**ReAct 工具调用是唯一活决策回路**（无 planner）。
- **Performance**：反思 / 检索走索引层，避免 O(N) 全扫；记忆有界（consolidator / cleanup）。

## 硬约定

**通用红线**

- **无兜底**：失败就抛明确异常，让调用方看见真实错误；默认值 / 降级 / 推断掩盖出来的「正常」比报错更危险。
- **DB 改动先征得同意**（migration / seed / 建表 / 删表，本地库也不例外）。
- **LLM 产出 / 工具入参用 Zod 校验**。

**agent**

- **工具**：`ToolDefinition` 在 `registry/auto-register.ts` 静态注册；粒度 = 一个完整语义动作（`search_web` / `read_page`），不是原子操作；新增 `ToolMetadata.category` 字面量**必须同步** `tool-prompt.ts` 的 `CATEGORY_NAMES` + `CATEGORY_ORDER` 两处，否则新工具静默归入「其他」；`execute` 内用 `pushWanderStep(ctx, ...)` 汇入 `ctx.wanderHistory`（现成 trace，勿另建机制）。
- **记忆**：`saveMemory` 三写（Markdown 真相源 + `INDEX.md` 人类导航 + `.index.json` 查询索引），原子写（temp + rename，同目录）；新索引需求**复用 `MemoryIndex`**（已有原子写 + 崩溃自愈 + 模块单例），不另建并行索引；记忆带 provenance（`untrusted:web` / `self:reflection` / `self:action`），反思只读 `provenance !== 'self:reflection'`（防自激）。
- **grounding**：反思每条洞察必须引用 ≥1 条真实存在的观察 id（`sourceIds`），无源整条丢弃——防幻觉核心，**不得绕过**，改反思结构时勿断此链；反思温度 0.4（一致性 > 创造性）。
- **数据路径**：一律 `getDataPath()`（锚定 `packages/agent/data`，与启动 cwd 无关，且尊重 `DATA_DIR`）；**禁模块级路径常量**——import 期求值会被固化，而测试在 import 之后才设 `DATA_DIR`，于是测试写穿生产数据；一律写成调用时求值的函数（缓存单例同理：调用处取 `getMemoryStore()`）。门禁：`grep -rn "['\"]data/" packages/agent/src --include='*.ts' | grep -v '\.test\.ts'` 应无输出。
- **异步**：所有 I/O 用 `fs/promises`；耗时操作（浏览器 / 外部进程）用 `execFile` / `spawn` 包 Promise + `AbortController` 超时。`execSync` 会卡死事件循环——心跳 / TUI 渲染 / `onStepFinish` / 反思调度全停摆。唯一豁免：`SkillIndex`（启动时一次性扫描 + 低频文件管理，不在热路径）。
- **浏览器**：SaaS worker 禁用外部浏览器 CLI（ADR-0016）；单机工具按 `config.browser?.enabled !== false` 条件注册。`BrowserExecutor` / `BrowserContext` 均按数据根缓存（同数据路径规则，防测试写穿）；Skill 文件 `data/skills/<name>/SKILL.md`（frontmatter 的 name `[a-z0-9-]+` ≤64 字符 + description 必填）。

**web（只读契约，不可破坏）**

- Web 是独立 Next.js app、后端 API 的**只读消费方**：数据只经后端 HTTP API（session 鉴权）+ SSE（`TenantEvent`）+ Web Push；**不直接读** agent / 后端的数据目录（早期轮询 `data/*.json` 已废弃）。
- **绝不写** agent 的数据文件——agent 是唯一写入方；后端侧写操作只经后端 API 的显式端点。
- **不复刻 agent / 后端的解析规则**：字段由上游派生，web 只渲染（规则一改必然漏掉一边）。
- 鉴权经 Casdoor（IdP）+ 后端 session，web 不自管密码。
- 视觉与动效遵 `docs/design-v3/DESIGN.md`（14 色宇宙、一切直角、实色偏移阴影、两帧法则、像素字体不排长文），`demo.html` 是动效验收基准；SSE 事件契约在 `@cyber-stray/shared/tenant-events`（后端与 web 同源，新增事件只改 shared）。

**site（官网）**

- 单页营销落地页，`output: "export"` 纯静态导出，生产 nginx 伺服（`deploy/Dockerfile.site`），无服务端逻辑、无数据依赖；主题锁定「深夜霓虹」（夜城即品牌本体，无浅色模式）。
- sprite 帧表契约与 web 同源：`@cyber-stray/shared/sprite`（读方 ≥2 已下沉，勿在包内复刻帧表换算）；`public/pet/strayboy/` 资产是从 web 复制的产物（真相源 `packages/web/scripts/sprite/build_sprite.py`，重生成后两处同步）。
- CTA 地址 = 构建期 `NEXT_PUBLIC_APP_URL`（流水线经 `vars.APP_URL` 注入）；站内文案改动照跑 Pre-Flight（宪法禁令清单 + 无 em-dash）。

**后端（`packages/control-plane`）**

- 分层 `routes → services → domain → infra`（另有 `auth/` 鉴权竖切与 `scheduler/`、`petgen/` 等功能竖切目录），依赖单向；route 只做鉴权 + 参数校验 + HTTP 映射。
- `src/routes/**` 有 ESLint 棘轮门禁（禁 `**/db/**`、`node:fs`、`node:child_process`、裸 `fetch`；测试文件豁免）——**只收紧不放松**；验收 grep 用 `from ['"][^']*/db/`（带斜杠，否则误中 fee**db**ack）。

## 工作流

1. **验证**：改动范围 `pnpm test` / `lint` / `typecheck` 通过（单包：`pnpm --filter <pkg> test`）；UI 改动在浏览器实测；较大任务分步汇报，不一次性堆大量改动。
2. **push 前查 diff**：无 `console.log` / `print` / TODO 遗留，无敏感信息（密码 / token / 私钥）。

## Git

- **一切改动先进 develop**：功能 / 修复 / hotfix 一律从最新 develop 切短期分支 → PR 目标 **develop**，一个 PR 对应一个逻辑单元。
- **发布保留历史**：`main` 只接受 **develop** 的发布 PR，用普通 **merge commit** 合并；main / develop 之间不 squash、不 rebase。

## 文档地图

| 内容                                     | 位置                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 视觉世界宪法（像素街区 STRAY-BOY）       | `docs/design-v3/`                                                                                             |
| 领域词汇 + 已锁定产品决策                | 根 `CONTEXT.md`                                                                                               |
| 架构决策记录                             | `docs/adr/`                                                                                                   |
| Web 重写实施计划 / 后端分层重构轨        | `docs/spec/web-rewrite.md` / `docs/refactor/README.md`                                                        |
| Issue、标签、triage、领域文档工作流      | `docs/agents/`                                                                                                |
| 用户路径决策点讨论稿                     | `docs/journey-brainstorm.md`                                                                                  |
| 历史：调研 / 评审与事故记录 / 旧内核 RFC | `docs/research/`、`docs/reviews/`、`docs/rfc-agent-kernel-refactor.md`、`docs/wave1-implementation-design.md` |
