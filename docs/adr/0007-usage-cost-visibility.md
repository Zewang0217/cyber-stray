# 0007 — 内部用量成本可视化：usage JSONL + admin 面板 + 全局模型配置

运营需要看成本：每宠物（租户）的 LLM token 消耗、生图张数、费用；当前用的哪个 AI 模型、面板直接更换。grill（2026-08-25）拍板：**内部运营成本可视化，不对外计费**（与"不建自建计量系统"语义并存——对外计费仍是 Stripe Billing Meters 的后续路）。

## 决策

**1. 用量记录 = 租户目录 `usage/usage-YYYY-MM-DD.jsonl`**（与 history/speaks 同模式）：
- 行结构：`{ timestamp, tenantId, kind: 'llm'|'image'|'vision_qc', model, tokens?, images? }`——**不含 cost**：费用由聚合 API 按单价表折算（单价表单一真相源在 CP，避免 agent/CP 双份单价漂移）
- 写入方：agent worker（游荡/日记/反思/微信/表情包文案的 6 个 LLM 调用点 + 表情包生图/质检装饰器）与 CP 进程（petgen 生图/质检，processor 注入 recorder）都写租户 usage 文件——worker 本地写无跨进程 DB 风险，CP 聚合读；模型名来自 AI SDK model.modelId / 配置，不新增签名
- 与现有 speaks/history 一致：备份天然包含、租户隔离天然成立
- 不用 control.db 表：worker 跨进程写 SQLite 有锁/事务风险；JSONL 追加原子、低频可接受

**2. 单价表 = 配置化默认值**（DB 存，admin 可改，不接外部价格 API——火山无公开价格查询接口）：
- Seedream Lite：$0.055/张；豆包视觉：输入 ¥3/M、输出 ¥9/M；DeepSeek：公开价/M token
- 费用 = 用量 × 单价（单价缺省用内置默认；admin 面板可覆盖）

**3. 模型选择 = 全局配置 + 热更新**（本期只暴露生图模型，LLM 模型选择留接口）：
- 存 DB（control.db 配置表），admin 面板下拉更换 → control-plane 读取（无重启）
- 生图模型默认 `doubao-seedream-5-0-lite`；视觉质检默认 `doubao-1.5-vision-pro`

**4. admin 面板 = 新 tab「用量」**（现有 admin 单页加 tab 结构）：
- 汇总卡片：总费用、LLM token 总数、生图张数、当前生图模型（+更换下拉）
- 每宠物表格：宠物名 / LLM tokens / 生图张数 / 费用 / 最近活跃
- 时间筛选：全部 / 近 7 天 / 近 30 天 / 本月
- 明细：最近调用记录（时间/宠物/模型/tokens/费用）

## Considered Options
- **control.db 用量表 vs 租户 JSONL**：worker 跨进程写 SQLite（锁/事务/文件位置跨 dataDir）vs JSONL 本地追加（与 speaks 同模式、备份隔离天然）→ JSONL。
- **外部价格 API vs 默认单价表**：火山无公开价格查询 API（账单 API 需 AK/SK 且滞后）→ 默认单价表 + admin 可改。
- **per-tenant 模型配置 vs 全局**：per-tenant（BYOK 风格）涉及配额/计费联动复杂度高 → 全局先行，接口留扩展。

## Consequences
- agent 6 个 LLM 调用点 + meme/petgen 生图与质检点各加一行用量记录（no-throw，不打断主流程）。
- CP 新增用量聚合 API（读各租户 usage JSONL → 汇总）+ admin 页「用量」tab。
- 存量无历史用量数据（埋点上线前的消耗不可追溯），面板从上线时刻起算。
