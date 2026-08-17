# CONTEXT — cyber-stray SaaS 共享领域语言

> 用途：多会话/多 agent 协作时的共享词汇与已锁定决策。只记**决策与非显而易见**的，不复制 CLAUDE.md/spec 已有内容。
> 来源：issue #42 RFC 讨论 + 调研（企业级 SaaS / 独立 SaaS / 多租户架构）。目标部署：单台 2 CPU / 4 GB VPS，systemd process-per-tenant 起步。

## 词汇（一个词一个义）

| 术语 | 含义 |
|---|---|
| **租户 tenant** | 付费/注册单位（≈组织 org）。**计费挂租户**不挂宠物。可养多只宠物。 |
| **宠物 pet** | 一只独立 agent 实例：独立 state / 记忆 / 兴趣 / 推送。核心价值（闭环自进化+主动推送）作用在宠物层。 |
| **控制面 control plane** | 共享（pooled）服务：认证 / 计费 / Web 应用 / 飞书·TG 推送网关。无聊的东西共享。 |
| **伴侣端 companion** | 主人交互面：首选 **PWA 网站**（一套代码覆盖移动+桌面，Web Push 推送）。 |
| **通道 channel** | 推送后端（飞书 / Telegram）。从"全局单一目标"改为"每租户绑定"，可选。 |
| **数据目录 data dir** | 租户隔离的 markdown 持久化单元（`DATA_DIR`）。= markdown 世界的 "database-per-tenant"。 |

## 已锁定决策（讨论中确认，勿擅改）

### 商业模式
- **双轨定价**：免费档 · Pro 固定月费 · BYOK 重用户自带 key（可仿 OpenRouter 抽 ~5%）。
- **不建自建计量系统**。DeepSeek token 是唯一真实 COGS；计量等规模上来再用 Stripe Billing Meters。
- **三档边界（已定）**：
  - 免费：推送 3–5 次/天，兴趣方向操控 **1 次/月**（**自进化始终免费**，宠物自己长兴趣不受限）。
  - Pro（建议 $3–5/月）：推送 ≤20 次/天，**可自定义推送时间**，兴趣方向操控 **1 次/天**。
  - BYOK：自带 DeepSeek key，不限（平台不烧 token）；操控≥Pro。
  - **多宠物尚未实现**——两档当前都 1 宠物；多宠物是后续版本钩子。
  - 区分框架 = 卡**主人手动操控**频率，不卡宠物自进化（勿把"自进化"做成付费墙，那是核心价值）。

### 多租户服务端
- **Bridge 隔离**：控制面 pooled + agent 运行时/存储 siloed。
- **调度器 + 短命 worker（宠物执行模型）**：宠物**不是常驻进程**。调度器扫控制面 SQLite，按"无聊/精力就绪"（由 `lastRunAt` + 流逝时间前推算，无需常驻进程）拉起短命 Bun worker，载入该宠物 markdown 记忆、跑一小段游荡、写回并更新 DB 状态、退出。任何时刻一宠物一 worker（隔离不变）。几百个注册宠物只有"正无聊"的几只醒着 → 一台 2h4g 就够。
  - 触发 = 无聊/精力（time-propagable）；方向 = 兴趣（InterestGraph focusTopics）；进化 = 反思 + 反馈。
  - **不是 Docker 起步**；横向加服务器/编排是命名的容量瓶颈触发后再上，映射不重构。
- **不迁 Postgres**：文件系统 markdown 持久化让租户隔离近乎免费；租户备份 = `tar` 一个目录。
- **租户解析**：JWT org claim 为准 + 路径前缀 `/t/<slug>`。不做子域名（单机要通配 DNS+证书，性价比低）。
- **安全硬规矩**：服务端剥掉客户端传入的 tenant header；每处数据访问带已验证 tenant id。
- **每租户 secrets**：信封加密，master key 包每租户 DEK，DEK 加密存租户目录（并存用户 key / 平台 key）。不用 Secrets Manager / Vault。
- **状态在盘**：worker 无状态可杀可拉；`getDataPath()` 按 `DATA_DIR` 即租户键。
- **鉴权 = Casdoor**（Apache 2.0，自托管）：Go 二进制跑 systemd unit（非容器），SQLite 嵌入式账号库（用户/组织/角色）。多租户原生的 organization 模型。
- **控制面元数据存储 = SQLite + ORM**（推荐 Drizzle/Prisma）：用户↔租户↔宠物↔账单等关系数据。**不上 Postgres 实例起步**；`SQLite↔Postgres` 靠 ORM 只需改连接串。触发切 Postgres 的**命名门槛 = 需多机共享控制面库**（SQLite 单节点不能多机写），非"客户变多"。

> 澄清：宠物数据仍是每租户 markdown 目录（不迁任何 SQL）。"控制面 SQLite"是另一层（注册/租户/计费/inventory），不违反记忆保持 markdown 约束。SQLite 本身即关系数据库（SQL/事务/索引），嵌入式 vs 服务器版才是真对比。

### 客户端
- **一套 PWA web**，租户上下文来自 JWT（前端状态是便捷，服务端 claim 是真相）。
- 主题 token + `plan` 门控启动时从 pooled API 拉取。
- **保留飞书/TG**（不破坏既有契约），降为可选通道；PWA 是首选伴侣面。
- **Dashboard 内容（已定）**：核心使命 = 让"自进化闭环"可见（区别于纯推送机器人）。
  - Slice 1：宠物主页（心情/精力/无聊值）+ 推送动态流（含推送理由）+ **内联反馈入口**（闭环必需项）。
  - Slice 2：兴趣图谱可视化 + 游荡足迹（数据可视化取向 A，用现有 interests/wander-history 数据）。
  - 后续方向 B：品牌 IP / 宠物拟人化（小动画/像素宠物）/ 美术素材采集创作——锦上添花，非首期。
  - 后续方向：**性格系统**——用户可选宠物性格（如好奇/慵懒/活泼），映射到行为参数（boredomGrowth/energyCost/explorationMode 倾向）。**非首期**。

### 用户旅程（已定）
```
注册(Casdoor, 首登自动建租户) → 领养宠物(起名/选初始兴趣,给默认+可改防后悔)
→ 宠物自我介绍(UI 展示) → 首推(PWA) → 反馈(点赞/踩/顶话题, 闭环) → 日常按 plan 频率
```
- 推送通道：**默认 PWA**；飞书可选（高级用户）。
- 出发点：让"自进化闭环"可见；免费用户体验"宠物自主进化"，Pro 得到"可操控"。

### 实时形态（已定）
- **两层实时**：应用内实时 = **SSE**（单向，替代 5s 轮询）；系统级推送 = **Web Push**（Service Worker，App 关了也收）。
- 选 SSE 不选 WebSocket：实时流几乎全单向（状态/推送），WebSocket 双工是给聊天/协同用，客户端动作（反馈）走 REST POST。
- SSE 租户安全：每条连接建立时绑定 tenant id（JWT），广播只推该租户连接，不跨租户泄漏。
- **无 Redis**：单机用进程内事件总线（调度器嵌入控制面进程或轻量本地 IPC）。Redis pub/sub = 多机共享触发点才上（与 Postgres 同一触发点）。
- 兜底：SSE 不稳时降级轮询。

### 反馈回路（已定）
- 首版 = **B：点赞/踩（👍👎）+ 顶话题（显式"我要更多这个方向"）**，走 REST POST。
  - 👍/👎：低价值高频信号，**不受批次节流**。
  - 顶话题：走"兴趣方向操控"节流（免费 1/月，Pro 1/天）。
- **轻交互 pet-interaction**（新术语，区别于反馈）：用户对**宠物本身**的状态表达（如拍拍/夸一句/回应心情），只影响 mood/语气，不影响 boredom/energy/temper/生存/自进化。与反馈同构路径（Web POST → 控制面 → agent worker 异步消化），但语义不同：反馈评价推送内容，轻交互表达对宠物的态度。不破坏 Web 只读契约。区别于 Tamagotchi 照料（照料会衰减生存，赛博宠物不会）。

## 待定（拍板前别写实现）
1. 向量库：暂不做，后续看检索是否需要（可加 SQLite 检索索引）。

> 记忆内容**保持 markdown**（人可读/可调试），不整体迁 SQLite（体量大）。编排状态进 SQLite；记忆可加 SQLite 检索索引（后续按需）。

## 硬约束（继承，勿违背）
- Bun/tsx + AI SDK v6 + DeepSeek + 文件系统 markdown 持久化。
- 记忆层保留人类可读 Markdown，不整体迁 SQLite。
- 飞书/TG 推送、TUI、Web 只读契约不可破坏。

### 术语澄清：赛博 = 云/在线（非赛博朋克）
- 产品语境里「赛博宠物」的**赛博** = **云/在线**（cloud-native, 一直在线的后台 agent），不是 cyberpunk 赛博朋克。
- 但项目名「Cyber Stray / 赛博街溜子」的「Cyber/赛博」在历史语境里指 cyberpunk/cyber culture（旧 DESIGN.md Cyber-Fluid 即此义，已作反参考废弃）。
- **视觉决策以此为准**：新视觉世界（维多利亚自然博物图鉴）不需要 carry 赛博朋克质感。「赛博」的科技感来自「云/在线」——宠物活在云端、自主运行、实时同步，而非来自霓虹/终端/金属质感。「会动的铜版画」这个 anachronism 的「赛博」读出 = 云端活物，不是 cyberpunk。
