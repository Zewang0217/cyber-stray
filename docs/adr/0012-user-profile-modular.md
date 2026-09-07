# 0012 — 用户画像目录模块化：单写者 + 派生摘要

原设计 `user-profile.json`（likes/dislikes 数组 + confidence）+ `interests.json`（图谱）双份数据并存。生产事故（issue #147）直接源于此：E2E 反馈写进 profile 的 dislikes=["天文"]，图谱与画像各自演化、互不同步，最终画像污染整个门控。调研（ScoutUserProfile）：没有任何系统把画像存成一个 blob——Letta"one block per functional unit"、OpenClaw 单主写者 + 门控巩固、Segment 身份图；Mem0 v2→v3 放弃原地覆盖改 ADD-only 正是因 update-in-place 丢/矛盾事实。

## 决策

**1. 画像 = 目录容器，模块化**：
```
user-profile/
├── identity.json          基本信息（称呼/时区/语言/会员等级）——低频写
├── settings.json          推送偏好/通道路由——用户+agent 写
├── user-interests.json    用户兴趣图谱——唯一写者 = 进化循环（ADR-0011）
└── profile-summary.md     派生叙述摘要——反思时 DeepSeek 从图谱重新生成
```
**2. 单写者纪律**：每个模块只有一个可写者；likes/dislikes 概念消解为兴趣图谱叶子权重，**绝不**再存第二份（杀死漂移根因）。`confidence/sampleCount` 保留为阻尼参数。

**3. 摘要 = 派生视图，绝不独立维护**：结构化文件（图谱）是真相源；叙述摘要仅做 prompt 注入，由 LLM 定期从图谱重新生成（增量更新，避免全文重写抖动）。独立维护叙述 = 漂移 bug。

**4. 宠物侧独立**：`curiosity-interests.json` + `memory/` 归宠物，`user-profile/` 归主人，边界清晰。

## Considered Options
- **单文件 vs 模块化目录**：兴趣图谱生命周期（高频更新/衰减/探索）与基本信息（低频稳定）写频率完全不同，混在一个对象互相干扰；模块化 + 单写者 = 防漂移机制 → 模块化。
- **likes/dislikes 数组 vs 图谱叶子权重**：数组无层级、无衰减、双份漂移；叶子权重精准（dislike 落叶子）+ 单一真相源 → 叶子权重。
- **结构化 vs 叙述**：结构化（图谱）用于决策与归因；叙述（摘要）只做 prompt 注入、LLM 从结构化重新生成，不做死 schema（BDE 固定 schema 在异构任务失败）→ 混合，叙述派生。

## Consequences
- `user-profile.json` 迁移为 `user-profile/` 目录；现有 likes/dislikes 数据迁移为图谱叶子权重（迁移脚本）。
- feedback 管道改写：反馈 → contentTopics 叶子归因 → 图谱权重更新（阻尼/饱和/衰减），不再写 likes/dislikes 数组。
- 反思时生成/更新 profile-summary.md（增量）；prompt 注入摘要而非裸图谱（缓存友好）。
- 领养仪式"选兴趣"仍写图谱根节点（种子）。
