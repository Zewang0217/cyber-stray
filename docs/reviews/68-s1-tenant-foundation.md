# Review · #68 · S1 租户化地基——可注入租户配置 + runOneWander 入口

> 两轴审查 · `review` skill（本会话首轮，口头审查，事后补文档）
> 基线 `3159d1b` (S0) → `e4564cb` (S1) · 单提交 · 26 文件 +698 / −190
> 日期 2026-08-16

## 基线

| | |
|---|---|
| Fixed point | `3159d1b` (S0) |
| Target | `e4564cb` (S1) |
| Commit | `feat(agent): S1 租户化地基——可注入租户配置 + runOneWander 入口（#68)` |
| Scope | 26 文件 +698 / −190（全 agent 包） |
| Spec | [issue #68](https://github.com/Zewang0217/cyber-stray/issues/68) |

## Standards

**0 硬违规 / 4 判断题。**

核心红线全守住：

- **数据路径**（conventions.md）：全部走 `getDataPath()`，调用时求值，无模块级路径常量；grep 门禁 `grep -rn "['\"]data/" packages/agent/src --include='*.ts' | grep -v .test.ts` = **0 命中** ✓
- **MemoryIndex 复用**：未另建并行索引类；grounding（`sourceIds`）链与 `provenance` 标记未动 ✓
- **无 execSync**：全异步 `fs/promises` ✓
- **反思温度 0.4 保留** ✓

判断题：

1. `auto-register.ts`：浏览器工具改为无条件注册，过滤移入 `ToolManager.get`——契约保全，租户化下合理。
2. `worker/cli.ts`：`readFileSync` 读 secrets + `console.log/error` 输出 JSON 作 CLI 契约——非热路径，但与 conventions「全异步」字面不符（CLI 入口可豁免，但 spec 未显式豁免）。
3. `tools/browser/executor.ts:21`：executor 缓存按 `session` 键化，但 `encryptionKey` 按租户烘焙——跨租户复用同一 session 时可能用首个租户的 key。当前不可达（`runOneWander` 不含浏览器），S5 前需修。**最严重项（latent）**。
4. `config.ts`：模块级 `config = loadConfig()` 为 S0 既有模式保留（向后兼容单用户）。

## Spec

**0 硬缺失 / 0 实现有误 / 0 超范围。** 四条验收准则全部达成。

- ✅ 同进程双租户游荡隔离——`run-one-wander.test.ts` 覆盖 `state.json.totalWanders` 互不污染、配置隔离、secrets 注入。
- ✅ 无硬编码 data/ 路径残留——grep 门禁空。
- ✅ 既有单用户行为不变——`config.ts` 保留模块级 `loadConfig()` 回退，既有测试通过。
- ✅ "run one wander and exit" 入口——`run-one-wander.ts` + `cli.ts`（`--tenant/--data-dir/--secrets-file`，退出码 0/1/2），可被调度器拉起。

## 汇总

| 轴 | 硬违规 | 判断题 | 最严重 |
|---|---|---|---|
| Standards | 0 | 4 | executor 跨租户 key 错位（latent，S1 不可达，S5 前需修） |
| Spec | 0 | 0 | 无 |

两轴共同指向**同一处**：`executor.ts` 按租户隔离 encryptionKey 未完成——S1 不可达但 S5 启用浏览器前是硬阻塞。
