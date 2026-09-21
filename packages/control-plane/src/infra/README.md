# infra/ — 基础设施层（I/O 实现）

db 读写（repo 函数）、外部进程（agent CLI 子进程）、文件访问的实现细节。
只实现存储与通信，不做业务判定（校验/守恒在 domain/，决策在 services/）。

约定：`db.update` 等 drizzle 调用只出现在本层，不得泄漏到 routes / services；
routes 不直接 import 本层（过渡例外：`tenant-access.ts` 供鉴权）；
分支门禁见 `eslint.config.mjs` 对已分层 route 文件的 no-restricted-imports。
