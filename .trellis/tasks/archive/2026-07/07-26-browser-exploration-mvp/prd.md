# 浏览器探索模块 MVP (Issue #44)

## 来源

GitHub Issue #44：浏览器探索模块——在互联网中游走的能力

## 概述

为 Cyber Stray 引入浏览器探索能力（MVP 阶段），使其能通过 agent-browser CLI 打开网页、感知页面结构、执行交互操作，并跨游荡保持浏览器会话。同时建立 Skill 文件系统基础设施，为后续 Skill 自进化（Phase 3，另开 issue）做好铺垫。

## 范围（MVP = Phase 1 + Phase 2）

### In Scope

| 模块 | 交付物 |
|------|--------|
| Module 1: agent-browser 基础设施 | `BrowserExecutor`（spawn 异步封装）、安装脚本、类型定义、单元测试 |
| Module 4: Skill 文件系统 | `data/skills/<name>/SKILL.md` 目录结构、SkillParser、SkillIndex、3 个 skill 工具、单元测试 |
| Module 2: 浏览器操作工具 | 3 个语义级 ToolDefinition（`browse_page`、`browse_snapshot`、`browse_act`）、注册到 auto-register |
| Module 3: 浏览器守护进程生命周期 | warmUp/shutdown、BrowserContext、集成到 main() 启动/关闭流程、配置项 |

### Out of Scope（后续 issue）

- Module 5: 反思引擎 ReAct 升级
- Module 6: Skill 自进化（轨迹收集 + 自动提炼）
- 社交登录/发帖/交互
- 反爬/验证码处理
- 视觉模型消费截图
- Skill lifecycle 自动化（stale/archive）
- 配套 Web/Mobile App

## 架构决策（Issue #44 评论已确认）

| 决策 | 结论 |
|------|------|
| 浏览器后端 | agent-browser CLI 包装（非 Playwright 直连、非 MCP 模式） |
| 调用方式 | spawn 异步 + AbortController 超时（非 execSync） |
| 浏览器生命周期 | 常驻守护进程（Agent 启动时 warmUp，关闭时 shutdown） |
| 工具粒度 | 3 个语义级工具（browse_page / browse_snapshot / browse_act），非 1:1 CLI 映射 |
| Skill 格式 | agentskills.io 标准：YAML frontmatter + Markdown 正文 |
| Skill 存储 | `data/skills/<name>/SKILL.md` + 可选 `references/` |
| Skill 加载 | 两阶段：browser_skill_list（元数据）→ browser_skill_load（全文） |
| 凭据管理 | MVP：手动预填；使用 agent-browser 内置 AES-256-GCM auth vault |

## 子任务与依赖

```
Phase 1 (并行)
├── 07-26-m1-browser-infra     (Module 1)
└── 07-26-m4-skill-filesystem  (Module 4)

Phase 2 (顺序)
├── 07-26-m2-browser-tools     (Module 2) ← 依赖 M1
└── 07-26-m3-browser-lifecycle (Module 3) ← 依赖 M1 + M2
```

## 验收标准

1. `pnpm setup:browser` 能安装 agent-browser 及 Chrome
2. `BrowserExecutor` 能成功调用 agent-browser CLI 并返回结构化结果
3. LLM 在 ReAct 循环中能使用 `browse_page`、`browse_snapshot`、`browse_act` 操作浏览器
4. 浏览器在 Agent 启动时预热、关闭时销毁；预热失败不阻塞启动
5. 跨游荡保持浏览器会话和登录态
6. `data/skills/` 下可创建、列出、加载 skill 文件
7. 所有新模块有单元测试；`pnpm test` / `pnpm lint` / `pnpm typecheck` 通过
8. 新增配置项（`browser.*`）有合理默认值，不影响无浏览器的用户

## 约束

- TypeScript strict + `verbatimModuleSyntax`（`.js` 导入扩展名必须）
- `noUncheckedIndexedAccess`（数组索引返回 `T | undefined`）
- 工具注册走现有 `ToolDefinition` + `auto-register.ts` 模式
- 配置走现有 `config.ts` 单例 + `agent-config.json` 合并模式
- 不引入新的运行时依赖（agent-browser 是 CLI 二进制，非 npm 依赖）
