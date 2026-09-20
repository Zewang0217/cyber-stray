# services/ — 应用层（用例编排）

一个用例一个入口（如 `feedback-service.ts` 的 `submitFeedback` / `boostTopic`）：
编排 domain 规则与 infra 存储/子进程，决定错误命运（回滚 / 翻译为结果）。

依赖方向：可 import `domain/` 与 `infra/`；不被 `domain/`、`infra/` 反向 import。
路由层只经 services 调用（当前过渡例外：鉴权的租户关系查询直连
`infra/tenant-access`，待 requireTenant 中间件收敛）。
