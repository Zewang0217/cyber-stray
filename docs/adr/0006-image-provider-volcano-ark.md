# 0006 — 生图供应商切换：DashScope → 火山方舟（Seedream 5.0 Lite + 豆包视觉质检）

产机 `.env` 的 `DASHSCOPE_API_KEY` 为空，宠物 IP 生图（#94）与表情包（#96）管线全链路不可用；视觉质检（qwen-vl）同样依赖 DashScope。经 grill（2026-08-25）拍板：生图与质检统一切换到火山方舟（Volcano Ark），LLM 对话保持 DeepSeek 不动。

## 决策

**1. 生图 = 火山方舟 Seedream 5.0 Lite**（同步 API，非 DashScope 异步任务）：
- 端点 `POST https://ark.cn-beijing.volces.com/api/v3/images/generations`，Bearer 认证（`ark-` key）
- 模型 `doubao-seedream-5-0-lite`（全局配置化，admin 可改；用户确认"用 lite"）
- 同步返回图片（base64/URL），替换现有 wanx 异步任务（提交 → 轮询 task）的客户端实现
- 尺寸沿用 1024×1024（成本最低档）

**2. 视觉质检 = 豆包 `doubao-1.5-vision-pro`**（同 Ark，OpenAI 兼容 chat completions）：
- 成本 ≈ ¥0.005–0.01/张（生图 ≈ ¥0.4/张 的 ~1/40，可忽略）
- 保持两层质检结构（结构层本地脚本 + 语义层视觉模型），管线契约不变

**3. 迁移方式 = 替换客户端实现，接口契约不动**：`ImageGenerator` / `VisionQc` / `StructureQc` / `Splitter` 接口保持；仅 `petgen/qwen.ts` 与 `meme/qwen.ts` 的 DashScope 实现替换为 Ark 实现（async 任务轮询 → 同步调用）。两处各自替换（petgen 在 CP 进程，meme 在 agent worker）。

**4. 密钥与模型配置化**：`ARK_API_KEY`（产机 .env）+ 模型 ID 存配置（DB，admin 面板可改）；DashScope key 相关 env 废弃。

## Considered Options
- **保留 DashScope 换 key**：用户无可用 key（DashScope 账号未配）→ 不可行。
- **生图换火山、质检保留 DashScope**：质检同样依赖 DashScope key（空）→ 不可行。
- **视觉质检换第三方（OpenAI 等）**：额外供应商 + 网络/合规成本，豆包视觉成本可忽略且同 Ark 同 key → 火山。

## Consequences
- `DASHSCOPE_API_KEY` / `CP_DASHSCOPE_*` / `MEME_*` env 废弃，替换为 `ARK_API_KEY` + 模型配置。
- 生图成本从 wanx（0.14 元/张）变为 Seedream Lite（≈¥0.4/张，更贵但可用）；质检从 qwen-vl 变为豆包视觉（≈¥0.01/张）。
- 图片生成从异步任务改同步：petgen 状态机（concept_generating → awaiting_confirmation）与 meme 管线（生图 → 叠加 → 质检）调用点不变，仅等待方式变化。
