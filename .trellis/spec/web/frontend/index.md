# Web 仪表盘规范

`packages/web/` — Next.js 16 + Tailwind CSS 4 + Framer Motion + Three.js。

## 只读契约（不可破坏）

- Web 是**独立 Next.js app**，**只读轮询** agent 的数据目录（`state.json` / `interests.json` / `history/*.jsonl` 等）。
- **路径统一走 `lib/data-path.ts` 的 `dataPath()`**，它解析到 `packages/agent/data`（可用 `DATA_DIR` 覆盖）。别在路由里写 `'../data/x'`——那是 cwd 相对的，monorepo 下会指到不存在的 `packages/data/`。
- **绝不写** agent 的数据文件——agent 是唯一写入方。
- **不复刻 agent 的解析规则**：数据文件的字段由 agent 派生并写入，web 只渲染。旧格式记录可以用通用文本处理（截断、取首行）降级补齐，但**不要**把 agent 侧的契约级正则（如 URL 提取）或内部状态（如 mood）在 web 再实现一遍——规则一改必然漏掉一边，参见 `guides/cross-layer-thinking-guide.md` 的 Mistake 4。
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
