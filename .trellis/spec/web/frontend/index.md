# Web 仪表盘规范

`packages/web/` — Next.js + Tailwind CSS 4。视觉世界 = design-v3「像素街区 · STRAY-BOY」（DESIGN / components / motion / stack 四文档 + demo.html 为验收基准）；重写实施计划见 `docs/spec/web-rewrite.md`。

## 只读契约（不可破坏）

- Web 是**独立 Next.js app**，control-plane API 的**只读消费方**：所有数据经 CP HTTP API（session 鉴权）+ SSE 事件流（`TenantEvent`）+ Web Push 获取；**不直接读** agent/CP 的数据目录（早期「轮询 `data/*.json`」模式已废弃）。
- **绝不写** agent 的数据文件——agent 是唯一写入方；CP 侧写操作只经 CP API 的显式端点。
- **不复刻 agent/CP 的解析规则**：字段由上游派生，web 只渲染。不要把 agent 侧的契约级正则或内部状态在 web 再实现一遍——规则一改必然漏掉一边，参见 `guides/cross-layer-thinking-guide.md` 的 Mistake 4。
- 鉴权经 Casdoor（IdP）+ CP session；web 不自管密码。

## Pre-Development Checklist

- [ ] 数据获取只走 CP API / SSE / Web Push，不引入任何直接读数据目录的路径
- [ ] 视觉与动效符合 design-v3 宪法（14 色、直角、实色影、两帧法则、steps() 动画）
- [ ] 遵循既有组件风格（Tailwind 4 + 无头行为基座，见 design-v3/stack.md 依赖宪法）
- [ ] SSE 事件类型与 CP 发布面一致（新增事件需同步 `useTenantEvents` 类型副本）

## 命令

```bash
pnpm dev:web                              # 开发服务器
pnpm --filter @cyber-stray/web build      # 生产构建
pnpm --filter @cyber-stray/web lint       # ESLint
pnpm --filter @cyber-stray/web test       # Vitest
```
