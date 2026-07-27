# Module 3: 浏览器守护进程生命周期

## 父任务

`07-26-browser-exploration-mvp`（浏览器探索模块 MVP，Issue #44）

## 目标

浏览器在 Agent 启动时打开，跨游荡保持登录态和浏览上下文，Agent 关闭时销毁。

## 需求

1. **BrowserContext 接口**
   - `currentUrl`、`currentPageTitle`、`openTabs[]`、`recentPages[]`、`sessionStartTime`

2. **生命周期管理** (`packages/agent/src/tools/browser/lifecycle.ts`)
   - `warmUp()`：Agent 启动时打开空白页，验证守护进程可用
   - `shutdown()`：发送 `close` 命令，清理守护进程

3. **集成到 main() 启动流程**
   - `initFeishuWS()` 之后、首轮心跳之前调用 `warmUp()`
   - 预热失败不阻塞启动（warn + skip browser 能力）

4. **集成到信号处理**
   - `registerSignalHandlers()` 中注册 `shutdown()`

5. **BrowserContext 注入 system prompt**
   - 每次游荡开始时：「你正在 {currentUrl}，标题：{title}。最近浏览：{recentPages}」

6. **browser_close 语义调整**
   - 常驻模式下改为「关闭所有标签页并打开空白页」，不终止守护进程

7. **配置项**
   - `browser.enabled`（默认 true）
   - `browser.closeAfterWander`（默认 false，常驻模式）
   - `browser.warmUpOnStart`（默认 true）
   - `browser.timeout`（默认 30000ms）

## 验收标准

- [ ] Agent 启动时浏览器预热成功
- [ ] 预热失败时 Agent 仍正常启动（降级为无浏览器模式）
- [ ] 跨游荡浏览器会话保持
- [ ] SIGTERM/SIGINT 时浏览器正确关闭
- [ ] BrowserContext 出现在 system prompt 中
- [ ] 配置项可通过 `agent-config.json` 覆盖
- [ ] 集成测试通过

## 依赖

- **Module 1**（BrowserExecutor）+ **Module 2**（浏览器工具集）必须先完成
