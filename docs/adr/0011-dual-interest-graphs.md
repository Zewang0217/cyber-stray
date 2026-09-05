# 0011 — 双兴趣图谱：用户兴趣（相关性）+ 宠物好奇（品味）分离建模

原设计单一 `interests.json` 扁平节点（科技/AI/天文/量子计算 4 个种子，weight 驱动）。生产实证（issue #147）：①图谱粒度与内容粒度不匹配——宠物探索丰富（黑洞/宇宙/JWST…）但图谱永远只有 4 个粗节点，反馈只能归因到"天文"；②图谱静止死锁——租户 worker 反思从不运行（反思调度器只在 StrayHarness 初始化，WanderAgent 路径缺失），图谱只靠 feedback 命中已有节点演化，永远无法分化；③"dislike 天文"一票否决整个领域（粗节点误杀）。

## 决策

**1. 双图谱分离，同一 taxonomy 骨架**：`user-interests.json`（主人偏好，叶子 weight）+ `curiosity-interests.json`（宠物品味，exploreCount + selfInterest）。共享同一 2-3 级层级树（根=领养仪式兴趣）。用户图谱 = 主人想看什么（相关性）；好奇图谱 = 宠物想探索什么（品味）；共同进 prompt，LLM 自判断权衡（ADR-0010）。

**2. Pinterest 式层级 taxonomy（非自由图、非纯 embedding）**：`总 → 粗 → 细叶子`。调研证据（ScoutInterestRepr）：分层在"可解释 + 粗→细归因 + 冷启动"场景赢（HieRec 击败单 embedding；Pinterest 生产用策展 taxonomy + 分类器）；图边在小规模稀疏连接时纯维护成本（KGAT 需维护 KG 才 5-9% 增益）；向量库全部不需要（<100 节点 JSON 内存 cosine 亚毫秒）。

**3. 用户兴趣图谱多信号权重**：like/boost/dislike + 未来访问频率（独立待办：推送点击埋点）。更新 = 半衰期衰减(60天) + Σ信号×强度×阻尼(1/(1+0.2n))×(1−weight)（饱和增长+边际递减）。dislike 只落叶子不碰父级（这次事故从机制上不可能再发生）。prompt 注入按强/中/弱分级展示（非裸数字，防 LLM 机械选最高导致单话题压制）。

**4. 宠物好奇图谱 = 自我品味（非被动计数）**：exploreCount（游荡被动计数）+ selfInterest（反思时 LLM 自我判断"我是否感兴趣"，依据=性格 novelty/familiarity 参数 + 记忆积累；先看效果，不好再移时机）。高 selfInterest → 说话更热情、更愿深挖；低 → 平淡带过；影响宠物说话方式与内容。

**5. 分类机制复用 DeepSeek**（不引小模型——频率低、零基建、分类与生成同一世界观）：speak 定稿后分类存 contentTopics（+1 调用/推送）；反馈按 contentTopics 精确归因叶子；反思时批量分类 + 自我兴趣判断。

**6. 探索-利用：先 prompt 引导（A），B 后备**：A = 好奇图谱高新奇话题在 prompt 单独高亮 + 分享准则给探索"许可"；B = 代码预留探索槽（日预算内固定比例强制来自好奇图谱）效果不好再加；UCB/ε-greedy（Netflix MAB）= 低优先级待办。

## Considered Options
- **层级 vs 扁平 vs 图边**：层级解决粒度不匹配 + dislike 误杀；扁平无结构、新话题孤立；图边小规模不划算 → 层级（Pinterest 模式，非其规模）。
- **复用 DeepSeek vs 本地小模型**：分类频率极低、DeepSeek 便宜、零基建；本地小模型只在高频/隐私场景值得 → DeepSeek。
- **单图谱 vs 双图谱**：单图谱把"主人喜欢"和"宠物好奇"混在一起，无法表达"宠物有自己的品味并影响说话方式"；双图谱分离两视角，prompt 里 LLM 权衡 → 双图谱。

## Consequences
- `interests.json` 迁移为 `user-interests.json` + `curiosity-interests.json`（层级结构）；`user-profile.json` 的 likes/dislikes 概念消解为叶子权重（见 ADR-0012）。
- 反思链路修复：租户 worker 补反思调度（跨进程状态化），反思产物（insight topic）挂层级树 + 更新好奇图谱。
- prompt 注入双图谱上下文 + 剩余预算（ADR-0010）；探索高亮段。
- speak 记录存 contentTopics（叶子路径），反馈归因按叶子精确落。
