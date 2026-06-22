# Pitfalls Research

**Domain:** 自进化赛博宠物 — LLM 反思 / 好奇心 / 兴趣进化 / 长期记忆
**Researched:** 2026-06-20
**Confidence:** HIGH（多数有学术 post-mortem + 社区共识 + cyber-stray 现存 bug 印证）

## Critical Pitfalls

### Pitfall 1: 反思幻觉 / 编造（Reflection Hallucination）

**What goes wrong:** LLM "反思"时编造并未出现在原始记忆里的"洞察"，且这些假洞察被回写为记忆，污染后续行为。
**Why it happens:** DeepSeek 在合成时倾向补全/泛化；若无 grounding 约束，输出不可信。
**How to avoid:** 反思产出必须**引用源 memoryId**；用 Zod schema 强制 `sources: string[]`；低 temperature；对无源/低支撑的洞察丢弃而非兜底（遵 CLAUDE.md "禁止兜底"）。
**Warning signs:** 洞察里的具体数字/引用在原始记忆里查不到；反思产出长度远超输入。
**Phase to address:** Phase 4（反思回路）

---

### Pitfall 2: 兴趣坍缩 / 模式坍缩（Interest Collapse）

**What goes wrong:** 兴趣图谱在反馈强化下快速收敛到 1-2 个话题，宠物变得"只会聊一个事"，可观测进化停滞。
**Why it happens:** 点赞是正反馈，早期偶发点赞被放大；没有探索/衰减制衡。
**How to avoid:** 兴趣权重**时间衰减**；保留 **novelty 探索项**（给低权重/新话题留探索预算）；单兴趣权重上限；兴趣数量下限。
**Warning signs:** 兴趣熵持续下降；连续多次游荡搜索词高度重复。
**Phase to address:** Phase 2（兴趣图谱）+ Phase 6（可观测性里加坍缩检测）

---

### Pitfall 3: 反馈偏差放大（Feedback Bias Amplification）

**What goes wrong:** 主人早期对某类内容多点了几次赞，模型过拟合，把"主人只喜欢这个"固化，错过主人其它兴趣。
**Why it happens:** 小样本 + 正反馈循环；画像置信度没随样本量校准。
**How to avoid:** 画像/兴趣带**置信度**，小样本时权重低；探索预算保证不全是"已喜欢"方向；区分"明确信号"与"沉默"（现有 prompt 已有此意识，需落到数据）。
**Warning signs:** profile 里某类 confidence 很高但样本数 <3；推送内容越发同质。
**Phase to address:** Phase 3（用户模型 + 反馈强化）

---

### Pitfall 4: 反思自激写放大（Reflection Runaway）

**What goes wrong:** 反思读"所有记忆"含上一轮反思产出 → 抽象层层叠加 → tokens 爆 + 抽象失真 + loop 失控。
**Why it happens:** 图省事让反思读全量；未隔离原始观察与反思产出。
**How to avoid:** 反思**只读原始观察类**（knowledge/observation/interaction），排除 insight 类；反思产出标记独立 type；反思**节奏上限**（每 N 游荡一次，非每游荡）。
**Warning signs:** insight 记忆占比持续上升；反思耗时/ tokens 逐次增长。
**Phase to address:** Phase 4（反思回路）

---

### Pitfall 5: 学习内容被注入污染 / 间接 prompt injection

**What goes wrong:** 抓取的网页（不可信）经 record_knowledge 成为记忆 → 后续反思/推送时被当成可信知识，甚至被恶意页面植入指令影响推送。
**Why it happens:** 现有 `read_page` 不区分可信度（CONCERNS.md 已记此风险）。
**How to avoid:** 记忆带 **provenance**（`untrusted:web` vs `self:reflection`）；反思/推送门控对 untrusted 记忆降权或隔离；推送前内容扫描（现有 `MAX_CONTENT_LENGTH` 之外的 URL/指令检查）。
**Warning signs:** 推送内容出现原始页面里的指令性语句；反思引用了明显不可信来源。
**Phase to address:** Phase 4（反思）+ Phase 5（推送门控）

---

### Pitfall 6: 记忆无界增长（Silent Memory Growth）— 现存 bug

**What goes wrong:** consolidator/cleanup 从不运行（已确认零调用点），记忆只增不减，拖垮检索/反思，`visited-urls.json` 也无上限。
**Why it happens:** 清理函数写了但没接线。
**How to avoid:** **接线 MemoryConsolidator + cleanupVisitedUrls**，随反思周期/启动调度执行。
**Warning signs:** `data/memory/` 文件数单调增；反思扫描耗时上升。
**Phase to address:** Phase 1（记忆基础设施）

---

### Pitfall 7: 静默失败掩盖反思/门控错误

**What goes wrong:** 反思或 PushGate 出错被 try/catch 吞掉（现有代码多处空 catch，CONCERNS.md 已记），宠物"看起来在进化"实则没。
**Why it happens:** 现有兜底习惯（违背项目 CLAUDE.md）。
**How to avoid:** 反思/门控错误**显式记录并上抛或明确降级**，不用空 catch；遵 CLAUDE.md "错误就是错误"。
**Warning signs:** 日志里反思相关 warn/error 但兴趣图谱没变；门控总返回同一结果。
**Phase to address:** Phase 1（修空 catch 习惯）+ Phase 4/5

---

### Pitfall 8: 推送门控过严/过松

**What goes wrong:** 门控过严→宠物从不推送（主人收不到价值）；过松→退化为现在的"啥都推"。
**Why it happens:** 阈值拍脑袋；无反馈闭环校准。
**How to avoid:** 门控阈值**可配置** + 用反馈(点赞率)在线校准；保留"偶尔主动推新奇内容"的探索预算，避免过严僵化。
**Warning signs:** 推送率长期≈0 或≈100%。
**Phase to address:** Phase 5（推送门控）+ Phase 6（可观测性校准）

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| 反思内联进游荡 | 少一个调度器 | 阻塞游荡 + 成本 + 写放大 | never |
| 兴趣只 append 不衰减 | 实现快 | 坍缩、无进化感 | never |
| 跳过 provenance 标记 | 省字段 | injection 风险 | 仅 MVP 早期、须尽快补 |
| 索引与 Markdown 不同步更新 | 省一次写 | 检索漂移 | never（双写在 saveMemory 钩子里原子做） |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| 反思 ↔ MemoryStore | 反思直接 readdir 全盘 | 经 MemoryIndex 查表 |
| InterestGraph ↔ state | 仍读冻住的 state.agentInterests | state 引用 InterestGraph 快照 |
| PushGate ↔ speak | 门控失败静默不推 | 显式返回决策 + 错误上抛 |
| Consolidator ↔ index | 清理记忆后不更新索引 | 删除时同步更新 .index.json（复用 deleteMemory 钩子） |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| getMemory 每读重写 accessedAt | 单次检索大量文件写 | 批量更新 accessedAt（每游荡/反思一次） | 记忆 > 几百条 |
| buildMemoryContext 按类型循环全扫 | 反思/注入慢 | 走索引单次查询 | 记忆 > 1k |
| 反思读全量含旧反思 | tokens/耗时线性涨 | 只读原始观察 + 节奏上限 | 反思产出累积 |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| 不区分记忆来源可信度 | 网页 injection 进反思/推送 | provenance 字段 + untrusted 降权 |
| 反思产出直接进推送无扫描 | 推送恶意/植入内容 | PushGate 内容扫描 + URL 审查 |
| interests.json 无校验直接加载 | 损坏文件致行为异常 | Zod 校验加载，失败显式报错（不兜底） |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| 强制 speak（现状） | "学习不推送"不成立，打扰主人 | PushGate 门控，默认可静默学习 |
| 推送同质化 | 主人觉得无聊 | novelty 探索预算 + 兴趣衰减 |
| 兴趣变化不可见 | 感受不到"它在成长" | 兴趣可观测性（导出/Web） |

## "Looks Done But Isn't" Checklist

- [ ] **反思：** 常缺 grounding（引用源）—— 验证每条洞察可溯源到 memoryId
- [ ] **兴趣进化：** 常缺衰减/上限 —— 验证兴趣权重会随时间变化且不坍缩
- [ ] **推送门控：** 常缺反馈闭环 —— 验证阈值能被点赞率校准
- [ ] **遗忘：** 常缺接线 —— 验证 consolidator 真的在跑、索引同步
- [ ] **索引一致性：** 常缺双写 —— 验证删记忆后索引也删

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| 反思幻觉已污染记忆 | MEDIUM | 标记/删除无源 insight；加 grounding 重跑反思 |
| 兴趣坍缩 | LOW | 重置权重 + 调衰减/novelty 参数 |
| 记忆无界已堆积 | LOW | 接线后跑一次 consolidateOldMemories + cleanupExpired |
| 索引漂移 | LOW | 从 Markdown 全量重建 .index.json |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 记忆无界增长（#6） | Phase 1 | consolidator 周期执行 + 文件数有界 |
| 静默失败（#7） | Phase 1 | 无空 catch；反思/门控错误显式 |
| 兴趣坍缩（#2） | Phase 2/6 | 兴趣熵不单调降；有权重衰减 |
| 反馈偏差（#3） | Phase 3 | 画像带置信度；探索预算生效 |
| 反思幻觉（#1）+ 自激（#4） + injection（#5 前半） | Phase 4 | 洞察可溯源；只读原始观察；provenance 标记 |
| 门控过严/松（#8）+ injection（#5 后半） | Phase 5 | 推送率合理；内容扫描；阈值可校准 |
| 兴趣坍缩检测（#2 验证） | Phase 6 | 可观测面板能看出进化曲线 |

## Sources

- Generative Agents（arXiv:2304.03442）— 反思机制与 grounding（HIGH）
- A-MEM / Memo 架构 — 周期合成记忆的失败模式（MEDIUM）
- "Memory for Autonomous LLM Agents"（arXiv:2603.07670）— manage 段失败模式（HIGH）
- Hindsight/Vectorize "Agent Memory Consolidation" — 合并/淘汰四杠杆与坑（MEDIUM）
- Curiosity-driven exploration（Pathak；DeepMind）— 内在动机坍缩与 novelty 解法（MEDIUM）
- cyber-stray `.planning/codebase/CONCERNS.md` — 现存 bug（空 catch、强制 speak、consolidator 死代码、injection 风险）（HIGH，第一手）

---
*Pitfalls research for: 自进化赛博宠物*
*Researched: 2026-06-20*
