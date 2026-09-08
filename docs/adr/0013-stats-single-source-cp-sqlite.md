# 0013 — 数值状态真相源统一：归 CP SQLite，注入 + 写回

宠物数值（精力/无聊/心情/脾气）自 SaaS 多租户改造周（#68/#72/#73，2026-08-14/15）起存在**双副本**：CP SQLite `pets` 表（调度器按时间前推 + 游荡后写回效果，**活的**）与 agent `state.json`（租户路径只耗不回，心情/脾气**从无更新点**）。裂缝的三面后果：#173（budget hook 读 energy=0 → read_page 全拒）、#213（HUD 读 state.json → 展示失真）、#215（心情/脾气冻结）。单机时代无常驻心跳之外的推进逻辑，#72 的前推只喂了调度决策，从未回到展示与门禁。

## 决策（Grill A 2026-09-07 拍板）

**1. 数值类状态唯一真相源 = CP SQLite `pets` 表**：energy/boredom/mood/temper 归库；agent `state.json` 的数值字段退役。叙事数据（游荡历史/记忆/兴趣图谱/反思状态）留在 agent 文件——`/api/state` 在读边界合成（库取数值 + agent 文件取叙事），**每个字段只有一个家**，无第二副本。

**2. 交接 = 注入 + 写回**：调度器拉起 worker 时注入最新数值；worker 跑完把新数值交回，CP 落库。**worker 不连数据库**——依赖方向保持 CP → agent，agent 保留无 CP 可嵌入性，测试不需要 DB。

**3. 删除 budget hook 的"energy < 20 禁 read_page"规则**（#173 的语义倒挂根因）：精力语义收窄为游荡燃料；防滥用交给既有护栏（每游荡步数上限 + 日预算）+ LLM 自判断（prompt 已注入当前状态，agent 自控节奏）。#174（deny 可观测）不受影响，预算 deny 仍存在。

**4. HUD 显示真实值**：去掉"饥饿 = 100 − 精力"换算皮（重写期发明的映射，无字段依据），四条分段墨条 = 精力/无聊/心情/脾气；`state=null` 显示未知态而非兜底健康值。design-v3 世界宪法（DESIGN.md §HUD、components.md §横栏）同步修订。

**5. 心情/脾气更新机制暂缺**：登记 #215（低优先级、需单独 grill、阻塞于本 ADR 落地）。统一前不新增更新点。

**6. 单机 TUI/Harness 心跳路径不再维护**：允许失效，不为它做 DB 适配。

## Considered Options

- **A 统一真相源（选）vs B 读时合并（双副本）vs C CP 写回 state.json**：B 保持两套推进数学（CP 按分钟 vs agent 按心跳阶梯），语义漂移不可收敛；C 需要跨进程文件写 + 锁，破单写者纪律；A 让"实际在工作的那份"（CP 前推 + 游荡写回都在它身上）成为唯一事实。
- **注入 + 写回（选）vs worker 直连 SQLite**：直连把 agent 绑死在 CP 的库 schema 上，依赖反向、测试变重；注入 + 写回边界最薄。
- **HUD 换算皮 vs 真实值（选）**：皮是前端自造机制（#214 审计 B 类实例）；真实值 + 演出层（饿表情等）保留游戏感，不失真。

## Consequences

- **#173 关闭**（被本 ADR 吸收：hook 读注入值，energy 不再可能卡 0）；**#213 拆票**（后端统一 + 前端 HUD 真实值）；**#153 反思调度方案不变**（worker tick，ADR-0010 同族），反思产物仍走 agent 叙事侧；**#214 审计的 C 类**（后端字段缺口）去向 = CP 字面补齐。
- 迁移：存量 `state.json` 数值 → pets 表一次性幂等脚本；此后 state.json 数值字段写入端移除。
- 推进数学归一：CP `propagate`（每分钟速率 + 性格系数）成为唯一推进逻辑；agent 侧 tiers/heartbeat 语义退役。
- prompt 状态注入来源改为注入值；worker 内所有读 energy/boredom 的路径（budget/boredom 触发）改读注入值。
