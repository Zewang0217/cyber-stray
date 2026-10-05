# Cyber Stray 推广就绪度、产品与软著评估

日期：2026-10-04。源码基线：`9f77ff5f02a2eb2b0904be0149c21fa047e0fce3`，与获取后的 `origin/develop` 一致。

本次由主代理与三个继承同一 GPT-6 模型配置的子代理审查，分别负责工程质量、安全上线、产品与市场，并对核心发现交叉复核。没有修改业务代码、执行数据库迁移、访问生产用户数据或调用真实付费模型。现有未提交文件保持原样。报告描述代码可证实的行为，生产环境另行部署的反向代理、隔离与补丁未纳入验证。

## 1. 可以开始推广吗

**可以做作品展示和招募首批测试者；当前不适合直接开放注册、放量或承诺稳定的付费服务。** 真正的多租户内测也应先处理浏览器隔离和登录安全边界，并打通至少一种完整的反馈渠道。

项目已经超过概念演示：有租户鉴权、独立控制面、短命 worker、主人兴趣与宠物好奇、反馈和反思模块、可读记忆、通知、像素界面、领养流程、日记、套餐约束及部署脚本。但“模块都有”尚不等于“生产执行链接通”。目前关键缺陷直接影响主轴：反思没有进入 SaaS 运行路径，默认 Web Push 的卡片反馈无法使用，首次领养可能忽略已选兴趣。

| 阶段 | 当前判断 | 前提与证据 |
| --- | --- | --- |
| 视频展示、介绍创意、收集意向 | 可以 | 清楚标明邀请内测与功能演绎，不承诺实测效果 |
| 少量受邀真实用户 | 修复关键链路后开展 | 租户浏览器隔离、登录事务绑定、反馈可用、首轮兴趣、通知闭环 |
| 公开注册与付费获客 | 暂缓 | 真实购买流程、成本计量、故障边界与生产验收尚不足 |
| 扩大流量 | 证据不足 | 还需要留存、内容价值、每活跃用户成本、并发容量数据 |

执行过的检查：agent、control-plane、web 三包 typecheck 与 lint 均通过；质量审查执行 131 项现有测试，安全审查执行 33 项，两组有价格测试重叠。测试包括策略、反思、反馈、租户 worker、Web 现有测试、浏览器执行器、候选生成与价格计算。Web 测试存在 React `act(...)` 告警。没有运行会建表的 CP 集成测试，也没有以全量测试或长时间压测宣称生产可靠。官网在本地 Chromium 中实际打开并截图，未捕获页面运行异常；这不等于登录或真实通知验收。

## 2. 最重要的代码与产品缺陷

### P1：推广前优先收口

**A. 反思驱动的进化未接入 SaaS 执行路径。**

生产路径是 `worker CLI → runOneWander → WanderAgent.wander`。反思调度 `tick()` 的业务调用仅出现在常驻 Harness；日记 worker 也没有接入它。

- [run-one-wander.ts:51](/home/zewang/PROJECTS/cyber-stray/packages/agent/src/worker/run-one-wander.ts:51)
- [stray-harness.ts:271](/home/zewang/PROJECTS/cyber-stray/packages/agent/src/core/stray-harness.ts:271)
- [reflection/scheduler.ts:111](/home/zewang/PROJECTS/cyber-stray/packages/agent/src/memory/reflection/scheduler.ts:111)

影响：探索后的话题强化与部分反馈更新仍存在，不能说“完全不会进化”；准确缺口是定期反思、带观察来源的洞察生成不在 SaaS 链路里。建议独立调度反思或在短命工作单元里显式等待完成。仅加 `await tick()` 不够，因为当前 tick 发起异步工作后返回，而 CLI 会退出。验收应实际运行多轮 worker，检查真实观察触发带 `sourceIds` 的洞察，且退出前落盘。

**B. 纯 Web Push 用户的卡片赞踩无法使用。**

`speak` 的 `messageId` 来自飞书或 Telegram；Web Push 不会补出这个字段。历史投影只透传字段，前端缺 ID 就禁用赞踩，反馈 CLI 同样要求消息 ID。

- [speak.ts:191](/home/zewang/PROJECTS/cyber-stray/packages/agent/src/tools/push/speak.ts:191)
- [history-record.ts:93](/home/zewang/PROJECTS/cyber-stray/packages/agent/src/tools/push/history-record.ts:93)
- [history-view.ts:57](/home/zewang/PROJECTS/cyber-stray/packages/control-plane/src/domain/history-view.ts:57)
- [PostcardDetail.tsx:67](/home/zewang/PROJECTS/cyber-stray/packages/web/components/strayboy/PostcardDetail.tsx:67)

这里丢的是消息 ID 字段，不是整条历史记录。结果是默认 SaaS 用户即使收到明信片，也无法完成赞踩驱动的偏好纠正。顶话题仍是另一条交互路径。建议由内容自身拥有稳定 ID，渠道消息 ID 作为投递关联；跨包契约由 shared 统一拥有。验收必须覆盖“不配置飞书/Telegram，仅 Web Push”的真实流程。

**C. 多租户可能共享外部浏览器会话。**

`getBrowserExecutor()` 用租户数据目录和 session 构造缓存键，却在创建实例时没有将配置的 session 传入无参 options，最终 CLI 使用默认 `cyber-stray`。worker 没有预热，同容器进程也没有租户级 HOME/profile/socket 隔离。

- [executor.ts:191](/home/zewang/PROJECTS/cyber-stray/packages/agent/src/tools/browser/executor.ts:191)
- [executor.ts:20](/home/zewang/PROJECTS/cyber-stray/packages/agent/src/tools/browser/executor.ts:20)
- [worker-runner.ts:114](/home/zewang/PROJECTS/cyber-stray/packages/control-plane/src/scheduler/worker-runner.ts:114)
- [Dockerfile.app:35](/home/zewang/PROJECTS/cyber-stray/deploy/Dockerfile.app:35)

已用本地实例验证：两个不同租户配置都得到 `session=cyber-stray`，`restore=true`，没有注入 encryptionKey；没有实际读取其他租户数据，不能表述为已经发生泄露。建议修复前关闭多租户浏览器，随后把唯一 session、状态路径、密钥绑定到租户，并执行两个租户并发浏览器集成验收。JS 单例分开不代表外部 daemon 分开。

**D. OIDC 登录事务未绑定发起浏览器。**

登录将 state/nonce/verifier 放进服务端 Map，回调仅凭 URL state 消费记录，没有浏览器关联 cookie。攻击者自己的未消费回调可以被转移到其他浏览器，造成用户误登录攻击者租户的登录 CSRF。

- [routes/auth.ts:31](/home/zewang/PROJECTS/cyber-stray/packages/control-plane/src/routes/auth.ts:31)
- [auth/state-store.ts:32](/home/zewang/PROJECTS/cyber-stray/packages/control-plane/src/auth/state-store.ts:32)

建议将短期 httpOnly 登录事务 cookie 与 state 绑定，回调同时核对并消费。验收包括“另一浏览器不能完成原浏览器发起的登录”。这是代码审查结论，没有对生产系统执行攻击。

**E. 外部网页读取缺少服务端网络边界。**

`read_page` 直接请求 URL，默认跟随重定向，并在读取整个响应后才提取正文；安全 hook 仍是骨架。URL 格式有效不代表目标地址可安全访问。恶意网页诱导的工具调用可能访问本机、内网或云元数据，大响应可额外消耗内存。

- [reader.ts:95](/home/zewang/PROJECTS/cyber-stray/packages/agent/src/tools/page/reader.ts:95)
- [registry/read-page.ts:22](/home/zewang/PROJECTS/cyber-stray/packages/agent/src/tools/registry/read-page.ts:22)
- [hooks/security.ts:12](/home/zewang/PROJECTS/cyber-stray/packages/agent/src/hooks/security.ts:12)

具体能访问哪些内部服务取决于生产网络，尚未实测。建议集中实现 URL 出站策略，校验解析地址与每次跳转，限制响应字节数，并对浏览器配置网络出口隔离。推送 webhook / subscription endpoint 的目标边界也应一起检查。

**F. 成本账本低估多步游荡，额外付费路径也缺少预算约束。**

`wander-loop` 持久化的是 `result.usage`，本地 AI SDK 6.0.220 源码明确它仅包含最后一步；所有步骤之和是 `totalUsage`。控制面预算依赖这份持久化账本。因此多步 ReAct 的成本和预算会低估。内存中的 `recordStep()` 统计了多步，所以不能说“所有 token 统计都错”。失败后重试的已消耗步骤还要单独覆盖。

- [wander-loop.ts:138](/home/zewang/PROJECTS/cyber-stray/packages/agent/src/core/wander-loop.ts:138)
- [scheduler/budget.ts:42](/home/zewang/PROJECTS/cyber-stray/packages/control-plane/src/scheduler/budget.ts:42)

此外，领养候选仅验证客户端 `batch<=3`，重复发送 `batch=0` 可以反复调用模型；服务端没有持久额度、幂等或该路径的 usage 记账。未知模型价格按零计、usage 写入失败仅告警，都会削弱预算可信度。

- [routes/pets.ts:327](/home/zewang/PROJECTS/cyber-stray/packages/control-plane/src/routes/pets.ts:327)
- [services/pets-service.ts:188](/home/zewang/PROJECTS/cyber-stray/packages/control-plane/src/services/pets-service.ts:188)
- [domain/pricing.ts:51](/home/zewang/PROJECTS/cyber-stray/packages/control-plane/src/domain/pricing.ts:51)

验收应覆盖多步成功、部分成功后失败、重试、未知模型、磁盘写失败、重复候选请求；对预算应明确定义可接受的整轮超额范围。

**G. 首次领养的兴趣冷启动漏读。**

`loadState()` 在 `state.json` 不存在时写入默认状态后提前返回，跳过下面的 `graph.load()`。领养写入的是兴趣种子，不是 state 文件。所以第一轮策略和 prompt 看不到刚选的兴趣。后续有状态文件时会加载图谱，**问题不是每次游荡都丢兴趣**。

- [agent/state.ts:70](/home/zewang/PROJECTS/cyber-stray/packages/agent/src/agent/state.ts:70)
- [wander-agent.ts:194](/home/zewang/PROJECTS/cyber-stray/packages/agent/src/core/wander-agent.ts:194)

临时目录验证：磁盘有“量子计算”，加载前 `focusTopics=[]` 且提示词出现“图谱为空”，显式图谱加载后列表含该主题。建议初始化流程统一保证策略构造前完成图谱读取，增加首次领养到首次推送的验证。

### P2 / 扩量前必须明确的问题

| 问题 | 影响与依据 | 建议 |
| --- | --- | --- |
| 日记没有全局并发上限 | 同一入睡窗口可按宠物数量同时 spawn，`scheduler.ts:398,446` | 独立有界队列、错峰与退避；目前不是已证实的线上宕机 |
| 历史写失败仍返回分享成功 | SaaS 网关依赖历史文件，磁盘异常会出现“成功但无投递内容”，`speak.ts:53,270` | 把交付记录落盘失败返回调用方，区分生成、持久化、投递 |
| 宠物列表请求失败进入领养界面 | 初始空数组与加载成功空列表未区分，`StreetCorner.tsx:83` | 独立错误态及重试，避免用户以为宠物丢失 |
| 推广 CTA 遇到邀请门 | 官网直接“领养”，新账号无邀请跳无申请入口的 need-invite 页 | 显式邀请内测入口、申请或候补机制 |
| 明信片没有可点击原文 | 契约已有 url，详情只有普通段落，`PostcardDetail.tsx:59` | 原文入口、来源与日期，保留结构化 URL |
| 套餐文案与实际限额冲突 | 官网 BYOK“不设限”，代码每天 20 条、操控每天一次 | 对齐权益；不要承诺尚未接通的自助购买 |
| 普通用户看见套餐切换但 API 仅管理员可用 | `settings/page.tsx:187` 与 `routes/plan.ts:44` | 标明内测人工开通或完成购买流程 |
| README 严重过期 | Bun、Planner、旧单包目录、your-username 与现状不符 | 更新架构、安装命令、演示、状态与边界 |
| 仓库部署模板仍为 HTTP 过渡版，官网 apex 返回 404 | `deploy/nginx/cyber-stray.conf:16,70`，compose 开放 Casdoor 8000 | 验证真实 HTTPS / IdP / 回调与官网路由；不能据模板断言线上仍如此 |

## 3. 创意、吸引力与付费可能性

**创意值得继续做。** 最有辨识度的定位是：“养一只会自己逛互联网、把好东西叼回来，并逐渐懂你的猫。”探索让宠物的行为有现实意义，宠物又给信息发现带来期待感。像素夜城、明信片和独立性格可以成为传播素材。

真正的风险是两边都只做到浅层：内容像普通资讯摘要，宠物只是播放动画。用户第一天可能因猫可爱而来，但持续留下，需要收到“我原本找不到、收到后确实想看”的内容，也能感知自己的反馈改变了后续探索。主轴的差异化是长期体验，需要真实用户数据证明，代码量和模型调用次数都不能代替。

首批用户建议聚焦成年独立开发者、设计师、像素/独立游戏与开源爱好者，他们兴趣明确，易判断发现是否有价值，也更容易接受像素宠物。另一组招偏宠物陪伴用户作为对照。暂不同时追求企业情报、泛娱乐陪伴、角色恋爱等市场。

官方参照（2026-10-04 核查；是产品机制参照，不是市场份额或销售证明）：

| 产品 | 相关能力 | 街溜子该如何区别 |
| --- | --- | --- |
| ChatGPT Pulse | 主动研究、个性化更新与反馈。[官方发布说明](https://openai.com/index/introducing-chatgpt-pulse/) | 主动本身已有竞争，要做到独立宠物、成长可见和中文垂直兴趣体验 |
| Particle | 个性化资讯、关注、来源与追问。[官方介绍](https://particle.news/blog/introducing-particle-the-news-organized) | 做好来源和继续阅读，避免停留在有趣摘要 |
| Finch | 虚拟宠物组织每日自我照顾体验。[官网](https://finchcare.com/) | 借鉴日常期待与温和回应，不用强制打卡惩罚主人 |
| Replika | 对话、记忆与陪伴，官方也说明它的助手能力边界。[官方说明](https://help.replika.com/hc/en-us/articles/5040453297293-Can-Replika-be-my-virtual-assistant) | 坚持能带回现实发现的宠物，不必全面追赶语音和角色扮演 |

尚未取得生产 D7/D14 留存、真实用户内容满意度和单位经济数据，不能判断“肯定吸引付费客户”。已有 X1 指标可用，但 D7—D14 回访一次加反馈一次只是初步参与信号，不能直接当作产品市场契合。

## 4. 功能优先级

先修断链，再加以下内容；日记、梦境、表情包、进化图谱、回滚与首推调度已经存在，不重复造。

1. **可追溯明信片。** 可点击原文、来源、资料日期、简短推荐原因与收藏。先使用已有 `url`，不要重造抓取链路；推荐原因要基于真实反馈或兴趣证据。
2. **负反馈原因。** 区分“早看过、内容不准、不感兴趣、今天太多”，避免将所有负反馈都解释成厌恶这个主题。已有反馈管线继续复用。
3. **一周成长回执。** 用具体证据说清“你赞了哪些内容，它因此开始探索什么”，能追溯到历史事件；可选择生成分享卡。比图谱熵更容易感知进化，也更容易传播。
4. **每日精选与通知节奏。** 用户可选择即时发现或每天一封，结合已有时间窗与预算。验证用户愿意接收多少，不把更高推送配额等同于更高价值。
5. **首次价值引导。** 内测申请、公开样例、领养后探索进度、通知状态与失败重试。已有首推任务保证，缺的是用户能理解并完成的路径。

桌面宠物适合在上述价值验证后做形态实验。语音、多宠社交、硬件、插件市场目前会扩大工程面，不能优先回答“内容是否值得持续接收”。

## 5. 两周验证方案

先完成主轴与安全修复，再招募 30 位非团队用户：15 位有明确内容兴趣，15 位偏爱像素宠物。从领养当天起观察完整 D0—D14，避免测试中频繁更改核心体验。

- 记录领养完成率、第一张有用明信片到达时间、通知送达、原文打开、赞踩、退订/静默、D7/D14 回访、每活跃用户真实调用成本。
- 请用户指出最有价值和最烦的一张卡，并解释原因；不能只问“你喜欢吗”。
- 预先约定内部继续门槛，例如 30 人中 12 人满足 X1、6 人能举出两次具体价值、3 人愿意按明确价格实际付费。这些数字是建议的试验门槛，不是行业基准，也不构成成功预测。
- 如果只是“猫好看”，优先改善内容；如果内容有用而宠物无人关注，检验宠物是否增加主动回访。第一轮目标是找出价值来源。

## 6. 可以申请软件著作权吗

**从现有代码和文档看，具备准备登记申请的基础；是否获准及权利最终归属仍取决于原创性、权属证明和提交材料。** 不要求先有收入或大量客户。法规保护独立开发并固定下来的程序与文档，保护不延伸到思想、处理过程、操作方法或数学概念；证书也不是对产品创意的独占授权。[《计算机软件保护条例》](https://www.cac.gov.cn/2013-02/08/c_12648744.htm)

通常需要申请表、程序和文档鉴别材料、身份证明及必要权属文件。常规交存为源程序和一种文档的前后各连续 30 页，不足 60 页则提交全部；除特定情况外，程序每页不少于 50 行，文档每页不少于 30 行。具体以正式申请系统要求为准。[《计算机软件著作权登记办法》第 9—11 条](https://www.beijing.gov.cn/zhengce/zhengcefagui/qtwj/201009/t20100929_776618.html)

仓库 `docs/software-copyright/` 已有“整个系统、Agent 内核、控制面”三组材料。本次 `pdfinfo` 检查三份源程序均为 A4、60 页，三份说明书均为 A4、8 页。这仅验证页数和尺寸，**不代表内容、连续性、每页行数或权属已验收**。该目录在本次开始时已是用户未提交文件，本次没有覆盖、重生成或提交。

提交前需要具体做：

1. 明确独立、合作、委托或职务开发性质，以及学校/公司资金、任务书和合同影响，不能仅因代码在个人账号就断定个人独占权利。
2. 软件名、版本、开发完成日与真实完成版本一致；记录申请所用 commit。已有指南的建议日期不能机械照抄。
3. 划清本人完成部分与第三方库、字体、图片和生成资产。使用第三方库不自动阻止登记，但不得把依赖源码作为自己的原创成果交存。未发现根目录项目 LICENSE；公开仓库不自动意味着他人获得开源许可，需要明确你的分发选择。
4. AI 辅助开发保留需求设计、架构决策、修改和验收记录；不能仅由“用了 AI”推断一定不能申请，也不能保证模型输出全部具有可主张的原创性。争议权属宜交由专业人员判断。
5. 优先考虑一个边界清楚的完整系统登记。内核与控制面是否单独登记，取决于真实独立功能与材料差异，不建议仅换名字重复交存。

官方办理入口为[中国版权保护中心](https://www.ccopyright.com.cn/)。本次该官网抓取未成功，在线表单与最新办理方式应以本人登录系统展示为准；未核实“加急价格或保证周期”，不沿用旧指南中的商业代办承诺。本段是材料准备建议，不构成确权意见。

## 7. 宣传素材交付

`artifacts/promo-20261004/` 为独立交付目录：36 秒 1080p 横版视频、原创程序合成音乐、浏览器预览、分镜图、字幕与可重现源码。素材基于仓库现有猫精灵和本地官网截图，宣传交互标注“功能演绎 · 邀请内测”。没有加入虚构用户数字、好评或性能指标，也没有把尚未打通的反思承诺写成经验证成果。

视频适合产品展示与内测招募。正式对外发布前，先把申请邀请的实际承接入口配置好；视频本身不会创建申请入口，也没有替你发布到外部平台。
