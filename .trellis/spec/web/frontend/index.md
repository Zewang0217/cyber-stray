# Web 仪表盘规范

`packages/web/` — Next.js 16 + Tailwind CSS 4 + Framer Motion + Three.js。

## 只读契约（不可破坏）

- Web 是**独立 Next.js app**，**只读轮询** `../data/*`（`state.json` / `interests.json` / 兴趣历史导出等）。
- **绝不写** agent 的数据文件——agent 是唯一写入方。
- API 当前**无鉴权**（已知边界，独立安全工作，不混进常规功能做）。

## Pre-Development Checklist

- [ ] 改 web 代码前确认：只**读** `data/*`，不引入任何写 agent 数据的路径
- [ ] 遵循既有组件风格（Tailwind 4 + Framer Motion）
- [ ] 新增 API 路由不暴露写操作

## 命令

```bash
pnpm dev:web                              # 开发服务器
pnpm --filter @cyber-stray/web build      # 生产构建
pnpm --filter @cyber-stray/web lint       # ESLint
```
