# 执行计划

## 基线（已确认）

- `pnpm install` 通过（需要先在 `pnpm-workspace.yaml` 填 `allowBuilds`，否则 pnpm 11 的 deps 检查会让所有脚本失败——已修）
- `pnpm test`：18 个文件 / 206 个测试全绿
- `pnpm typecheck`：**已经是红的**，`packages/agent/src/memory/long-term/consolidate.test.ts:327-330` 四处 TS18048（`consolidation` 可能为 undefined）。属既存问题，本任务顺手修掉，否则验收门禁没有基准。

## Step 0 — 修复既存 typecheck 失败

- `consolidate.test.ts:326` 的 `expect(consolidation).toBeDefined()` 对 TS 不产生收窄，改成显式 throw 收窄后再断言字段。
- 验证：`pnpm typecheck` 全绿。

## Step 1 — agent 数据路径锚定（design A1 + A2）

1. `config.ts`：引入 `fileURLToPath` / `join`，定义 `AGENT_DATA_ROOT`，重写 `getDataPath()`；`CONFIG_PATH` 常量改为调用 `getDataPath('agent-config.json')`。
2. 逐个收编硬编码相对路径，全部改成**调用时求值**的函数，不留模块级路径常量：
   - `memory/user-profile.ts:9`
   - `memory/long-term/types.ts:76`（`basePath` 默认值下沉到 `MemoryStore` 构造）
   - `memory/long-term/memory-index.ts:294`（默认参数惰性化）
   - `memory/feedback-store.ts:14`
   - `logger/file-writer.ts:20`、`logger/log-cleaner.ts:19`
   - `tools/push/speak.ts:48-49`
3. 检查 `logger` 的循环依赖风险：`config.ts` 目前不 import logger，`file-writer.ts` 引入 `getDataPath` 后需确认没有形成 `config → logger → config` 环。

**验证**：`grep -rn "['\"\`]data/" packages/agent/src --include='*.ts' | grep -v '\.test\.ts'` 应无输出。

## Step 2 — 测试隔离适配（design A3）

1. `test/helpers.ts` 的 `useTempDataDir()`：`DATA_DIR` 指向 `<tmp>/data`，chdir 仍指向 `<tmp>`；返回值增加 `root`。
2. `config.test.ts:11` 断言改为锚定后的绝对路径（用 `import.meta.url` 推导期望值，不要写死机器路径）。

**验证**：`pnpm test` 仍然 206 passed，且没有测试写到仓库里的真实 `packages/agent/data/`（跑完 `git status` 应干净）。

## Step 3 — 历史记录派生逻辑（design B2）

1. 新增 `packages/agent/src/tools/push/history-record.ts`：导出 `deriveTitle` / `deriveSummary` / `buildSpeakRecord`，纯函数。
2. 新增 `history-record.test.ts`，覆盖：带 URL 的 share、纯碎碎念、多行内容、超长中文截断、空内容回退。

## Step 4 — 写入侧接线（design B1 + B3 + B4）

1. `tools/push/speak.ts`：`SpeakRecord` 扩展 v2 字段；`speak()` 增加可选第三参 `meta`；导出 `recordGatedSpeak()`。
2. `tools/registry/speak.ts`：
   - 门控通过路径：`speak(content, type, { mood: ctx.state.mood, gateScore })`
   - 门控拦截路径：return 前调用 `recordGatedSpeak(content, type, { mood: ctx.state.mood, gateScore, gateReasons })`
   - **不要**在拦截路径自增 `ctx.spokeTimes`（它会进 `state.totalPushes`，门控拦截不是推送）

## Step 5 — web 侧路径（design A4）

1. 新增 `packages/web/lib/data-path.ts`。
2. 四个路由改用 `dataPath(...)`：`api/state`、`api/history`、`api/interests`、`api/interests/history`。
3. 顺手修掉 `lib/types.ts:3` 和 `api/interests/route.ts:9` 里指向迁移前 `src/` 的过时注释。

## Step 6 — web 渲染（design C1 + C2）

1. `lib/types.ts`：`PushContent` 增加 `content?` / `type?` / `pushed?` / `gated?`，并放宽 `title` / `summary` / `message` / `mood` / `url` 为可选。
2. `api/history/route.ts`：增加 `normalizeRecord()`，旧格式从 `content` 派生。
3. `components/ui/FeedCard.tsx`：三态徽标；`url` 缺失时不渲染外链按钮。

## Step 7 — 端到端验证

1. `pnpm typecheck` / `pnpm lint` / `pnpm test` 全绿
2. 造一份最小 `packages/agent/data/`（`state.json` + `interests.json` + 一条新格式和一条旧格式的 `history/speaks-*.jsonl`），`pnpm dev:web` 起服务后 curl 四个接口，确认都返回 `success: true` 且数据非空
3. cwd 无关性验证：从仓库根执行一次只触发路径解析的脚本，确认解析结果指向 `packages/agent/data/`
4. 清理验证用的临时数据（`packages/agent/data/` 已被 gitignore，不会污染提交）

## 回滚点

- Step 1-2 是一组（路径 + 测试适配），要回滚一起回滚
- Step 3-4 是一组（写入侧）
- Step 5-6 是一组（web 侧）
- Step 5 依赖 Step 1 的目录约定，但不依赖 Step 3-4；Step 6 的旧格式降级逻辑保证了即使 Step 3-4 未生效也能正常展示

## 不做的事

- 不给历史数据写迁移脚本（运行态产物，且已 gitignore）
- 不动 `speak` 工具暴露给 LLM 的入参 schema
- 不补 `/logs` 页面、不动 Settings 页面、不重写 README
