# Module 1: agent-browser 基础设施

## 父任务

`07-26-browser-exploration-mvp`（浏览器探索模块 MVP，Issue #44）

## 目标

`BrowserExecutor` 能通过 spawn 异步调用 agent-browser CLI，返回结构化结果。

## 需求

1. **安装脚本** `scripts/setup-agent-browser.ts`
   - 下载 agent-browser 二进制到 `.bin/`
   - 执行 `agent-browser install` 安装 Chrome
   - `package.json` 添加 `pnpm setup:browser` 脚本

2. **BrowserExecutor** (`packages/agent/src/tools/browser/executor.ts`)
   - spawn 异步调用（非 execSync），Promise 封装
   - 统一追加 `--json --session cyber-stray` 参数
   - AbortController 超时控制（`AGENT_BROWSER_TIMEOUT` 环境变量，默认 30s）
   - 返回 `BrowserCommandResult { success, data, stderr, durationMs }`

3. **类型定义** (`packages/agent/src/tools/browser/types.ts`)
   - CLI 命令返回的 TypeScript 接口

4. **单元测试** (`packages/agent/src/tools/browser/executor.test.ts`)
   - mock spawn，验证参数拼接、超时、错误处理

## 验收标准

- [ ] `BrowserExecutor.execute('open', ['https://example.com'])` 返回结构化结果
- [ ] 超时后 AbortController 终止进程
- [ ] CLI 不存在时返回友好错误（非 unhandled exception）
- [ ] 单元测试通过

## 依赖

无（Phase 1，可并行）
