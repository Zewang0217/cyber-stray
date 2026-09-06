# packages/web 前端完全重写实施 spec ——「像素街区 · STRAY-BOY」

> 状态：**终稿**（wayfinder 地图 [#165](https://github.com/Zewang0217/cyber-stray/issues/165) 目的地交付物，2026-09-06）。
> 汇总决议：[#166](https://github.com/Zewang0217/cyber-stray/issues/166)（A 侧自绘研究）· [#167](https://github.com/Zewang0217/cyber-stray/issues/167)（B 侧生图研究）· [#168](https://github.com/Zewang0217/cyber-stray/issues/168)（A/B 原型，持机人判 B 表现力胜出）· [#169](https://github.com/Zewang0217/cyber-stray/issues/169)（管线落锤 + 帧表 v2）· [#170](https://github.com/Zewang0217/cyber-stray/issues/170)（11 页重铸映射）· [#171](https://github.com/Zewang0217/cyber-stray/issues/171)（delight 分级）。
> 世界宪法：design-v3 四文档（DESIGN / components / motion / stack）+ demo.html（动效验收基准）。
> 实施会话拿本文档即可开工，无需再做决策。发现本文与宪法冲突时以 design-v3 为准并回修本文。

## Problem Statement

持机人打开现有 PWA 看到的是旧世界（维多利亚博物图鉴 + react-three-fiber 3D 场景 + framer-motion 平滑动效），与项目已定的新世界宪法「像素街区 · STRAY-BOY」完全脱节：视觉不是像素风、动效违反两帧法则、3D 猫与 9 状态像素 sprite 资产不匹配、无 PWA manifest、SSE 事件类型副本漏 `diary_generated`。11 个功能路由本身可用，但每一个的视觉与交互都要按新宪法重铸。旧 UI 留在 main 可用，重写不能砸现有功能。

## Solution

在 `feat/web-rewrite` 分支**原地重写** packages/web：同一批路由与数据契约（CP API 只读消费方 + SSE + Web Push 不变），视觉与交互全部换为 STRAY-BOY 掌机——**4 tab + START 键 + LOG 存档抽屉**骨架，像素夜城街景，橘猫街溜子 9 状态帧动画（sprite 混合管线资产），分段墨条 HUD，纸面明信片墙。分期交付：T1 持机人核心体验（街角/领养/墙上/图鉴/START 三子屏 + delight A 组），T2（设置/维修口/微信招贴/登录/改造屋）。追平后合并切换。

## User Stories

1. As 持机人, I want 打开 PWA 看到一台 STRAY-BOY 掌机（顶栏铭牌/电源灯/DAY N 时钟），so that 我明确感到这是一台"设备"而不是网页。
2. As 持机人, I want 街角默认屏里橘猫以 idle 帧动画待在路缘线上、尾相与眨眼循环, so that 猫是活的。
3. As 持机人, I want 点猫拍拍触发 pat 帧 + 爱心像素上飘 + 心情墨条 +1 + 对话框换词, so that 我与猫有真实互动反馈。
4. As 持机人, I want 连拍与第 4 连拍触发 joy/呼噜话/grumpy 翻脸的差异化反馈, so that 猫有性格而不是按钮。
5. As 持机人, I want HUD 显示 3 条 10 格分段墨条（饥饿↔精力反向、无聊、心情↔脾气）, so that 宠物状态一眼可读。
6. As 持机人, I want 点 LV 名牌弹角色属性卡（性格/口头禅/固执/连续失败/里程）, so that 深层数据可查而不占屏幕。
7. As 持机人, I want 「让它去溜达」按钮触发猫走出屏幕, so that 我能主动让猫出门找内容（依赖新 CP API，见 Implementation Decisions #12）。
8. As 持机人, I want WanderLog 以 4 行游戏 log 实时滚动游荡记录, so that 猫的动向像游戏一样可追。
9. As 持机人, I want 新明信片到达时猫 pounce → 明信片贴顶落下 → NEW! 徽章闪烁 → 日志追加 1 行的完整编排, so that 推送有"寄回来"的仪式感。
10. As 持机人, I want 墙上（明信片墙）以纸面卡展示全部历史推送、未读带 NEW! 徽章, so that 我能翻阅猫寄回的所有内容。
11. As 持机人, I want 在明信片上 👍/👎 反馈并置顶话题, so that 我的口味能影响推送。
12. As 持机人, I want START 键打开全屏菜单进入日记本/梦呓集/贴纸册子屏（切屏熄灭 2 帧 → 点亮 f8）, so that 子功能有"换卡"仪式感。
13. As 持机人, I want 日记本以跨页纸面（paper+ink + VT323 日期签）按月浏览、点开单页, so that 日记像手账。
14. As 持机人, I want 梦呓集以 sky 底 + 星点 + 浮空梦卡展示抽象叙事（斜体）, so that 梦与日记质感分离。
15. As 持机人, I want 贴纸册以像素贴纸墙（白描边 + 像素胶带钉册页）展示 meme, so that 表情包像贴纸收藏。
16. As 持机人, I want LOG 面板「存档」抽屉（vaul）保存游荡日志历史, so that 实时 log 之外可考古。
17. As 持机人, I want 图鉴 tab 以条目轨道展示兴趣进化（像素墨条, 无 SVG 折线图）, so that 兴趣演化可读。
18. As 持机人, I want 图鉴内时间机器用 SAVE SLOT 纸面便签 + 「读取存档 LOAD」语法回滚兴趣图谱, so that 回滚是游戏操作而非表单。
19. As 持机人, I want 回滚成功后猫 grumpy 30s 说「唔……回到这一天了」, so that 回滚有代价感。
20. As 持机人, I want 图鉴新条目时猫 pounce「叼回来一个新话题！」, so that 进化被演出。
21. As 持机人, I want 首次进入走全屏开机仪式（▶ NEW GAME → 起名 LLM 3 候选 → 性格 4 卡 → 口头禅 → 兴趣贴纸 → 猫 walk 入场自我介绍 → 开始游荡）, so that 领养像开新游戏。
22. As 持机人, I want 领养确认时仅有的一处方块纸屑, so that 时刻被庆祝。
23. As 持机人, I want ~90s 无交互后猫自己演小剧场（walk/joy/think + 自言自语 DialogBox）, so that 猫不依赖我也活着。
24. As 持机人, I want 夜空月亮显示当夜真实月相、作息时段自动切白天/深夜主题与窗灯率, so that 街区与真实时间共眠。
25. As 持机人, I want 移动端拍拍/明信片落位有轻震动（尊重 prefers-reduced-motion）, so that 掌机感落在手上。
26. As 持机人, I want LV = totalWanders÷10 派生并在升级时名牌闪光 + DialogBox, so that 陪伴有进度感。
27. As 持机人, I want 全站 DAY/N 时钟、霓虹招牌（一屏 ≤1）、邮票 4 款、切屏熄灭等宪法演出默认在场, so that 世界一致。
28. As 持机人, I want 设置 tab 以游戏系统菜单（单列菜单行 → 子屏：通道/宠物/账号/维修口）管理配置, so that 设置也是世界的一部分。
29. As 持机人, I want admin 以「维修口」形态保功能可用（直角/14 色/实色影底线、桌面宽表格）, so that 运维不破世界。
30. As 持机人, I want 微信绑定页以街机招贴形态（掌机大图 + 三步指引 + 二维码设备框、免登录可访、?rebind 保留）, so that 绑定像街机厅广告。
31. As 持机人, I want 登录/注册为自建像素页（未通电掌机 box-art、电源键=登录，Casdoor 仍为 IdP）, so that 登录不跳出世界。
32. As 持机人, I want 改造屋（/pet/customize）以问卷纸 → 概念图相框确认 → 分段墨条进度 → 素材网格预览走完 IP 定制, so that Pro 功能与 sprite 管线（#169）一致。
33. As 持机人, I want 手机竖屏优先、桌面自适应（菜单条底部居中悬浮）, so that 掌机在口袋里。
34. As 持机人, I want PWA 可安装（manifest + 图标 + 主题色）, so that 它真的像一台设备住在我手机上。
35. As 持机人, I want `prefers-reduced-motion` 时无限动画停帧第 1 帧、事件动效保留, so that 动画可关。
36. As 持机人, I want 页面不可见时移除全部 infinite animation, so that 不偷电。

## Implementation Decisions

1. **分支与节奏**：`feat/web-rewrite` 原地重写 packages/web，PR 目标 develop；旧版在 main 保持可用，追平后合并切换。T1 = 街角 + 领养 + 墙上 + 图鉴（含时间机器）+ START 三子屏（日记/梦呓/贴纸册）+ LOG 抽屉 + delight A 组；T2 = 设置 / 维修口 / 微信招贴 / 登录注册 / 改造屋 + delight B 组。每票验收 = `pnpm test/lint/typecheck` + 真实浏览器截图 + 视觉模型评审 + subagent code review。
2. **依赖（stack.md 钦定，无悬念）**：移除 `three`/`@react-three/*`/`postprocessing`/`@fontsource/caveat`/`@fontsource/eb-garamond`（v2 3D 世界遗产）；新增 `motion`（仅 AnimatePresence/layout，tween 一律 linear）、`@formkit/auto-animate`、`vaul`、`sonner`、`canvas-confetti`（square shapes，全站仅领养/进化两处）、`howler`（默认关）；字体 `@fontsource/press-start-2p` + `fusion-pixel-font` + `@fontsource/vt323` + `@fontsource-variable/noto-sans-sc`；保留 next/react/tailwindcss v4/@radix-ui 无头/clsx/tailwind-merge/react-markdown。不引 Rive/成品皮肤库/图表库/Lottie/GSAP/NES.css。
3. **全局骨架**：页面 = 掌机（顶栏铭牌 + 电源灯呼吸 + DAY/N 时钟；主屏游戏层；面板区 UI 层；底部 4 tab 菜单条 + START 键）。街区之外 = 全屏换屏（熄灭 2 帧 → 点亮 f8）；活体感 = 全局 DialogBox/Toast（任意 tab 弹状态变化/新邮件）。全站注解语法 = 像素骨架（结构/计量）+ 纸面注解（paper 便签 ±1.5° 旋转 + 图钉/胶带 + VT323 日期戳）。宪法四预算（一屏一次强调 / 并发 ≤3 / 霓虹 ≤1 / 纸屑两处）为硬闸门。
4. **路由映射**（11 路由全保留，按 #170 决议表执行）：`/` 街角（T1）；`/history` 墙上（T1）；`/diary` 日记本（T1 尾）；`/dream` 梦呓集（T1 尾）；`/footprint` LOG 存档抽屉（T1，路由重定向到街角抽屉态）；`/meme` 贴纸册（T1 尾）；`/evolution` 图鉴 + 时间机器（T1）；`/settings` 系统菜单（T2）；`/admin` 维修口（T2 最后铸）；`/wechat` 街机招贴（T2，免登录）；`/pet/customize` 改造屋壳（T2）；新增 `/login` 自建像素页（T2，Casdoor 302 流不变）；领养仪式 = 全屏开机画面（T1，现 PetIntro 并入终点）。
5. **宠物 sprite**：按 #169 落锤执行——`cat.png`（横排）+ `frames.json`（`stray-boy.sprite.v2`：frame{w:32,h:32,groundRow:30} + animations from/frames/duration/loop + overlays.hungry{eyes.png,2,1.2s} + palette + provenance）；帧表 = idle 4 / walk 4 / joy·eat·sleep·think·celebrate·grumpy·welcome 各 2 / pat·pounce 各 2 = 26 帧 + eyes 2 帧。播放器 = 纯 CSS steps()（motion.md §3 类名契约：`data-anim`/`data-hungry`），单 sheet ≤8KB，`image-rendering: pixelated`。**默认猫上线资产 = A 侧预生成 10 帧**（prototype/sprite-ab 分支资产迁入）；B 基混合管线（生图 base + 程序派生）为资产生成管线，不在 web 重写范围内。
6. **HUD 字段语义**：3 墨条 = 饥饿（↔精力反向显示）、无聊、心情（↔脾气反向）；数值全部来自现有 CP state 读数，前端不造字段；LV = `totalWanders ÷ 10` 向下取整派生；固执/连续失败/里程入属性卡。SSE `useTenantEvents` 类型副本补 `diary_generated`。NEW! 徽章 = timestamp + localStorage 前端推导（无已读字段，多端不同步已接受）。
7. **数据契约不变项**：web 仍是 control-plane 只读消费方（CP API + SSE TenantEvent + Web Push）；现有 hooks 层（useHistory/useEvolution/useFeedback/useChannels/useWebPush/useWechatBind/usePetGen/useAdmin…）为数据 seam，重写保留其接口形态、只换渲染层；`@cyber-stray/shared` 的 PET_STATES/manifest 类型按 manifest v2 扩展（shared 侧改动属本 spec 允许范围，仍不动 agent/CP 运行时）。
8. **新 CP API 建议（spec 层面，不实施）**：`POST /api/walk` 手动触发游荡（「让它去溜达」按钮依赖它）；API 未落地前该按钮**不上**（不做假交互）。petgen 退役范围按 #169 §4：保留状态机骨架/配额/热切换/概念图确认，替换生成层为混合管线——此项与 POST /api/walk 同属"动 CP 侧"，**动工前需持机人同意，另票执行**。
9. **meme 方向**：贴纸册按 #170 走像素风（现有 meme 生图后续切 pixelize 后处理 + 像素 QC + 宠物锚点帧参考图——管线在 CP/agent 侧，本 spec 只保证贴纸册 UI 以像素贴纸为唯一形态展示）；删除补 DialogBox 确认；QC 不过不收录。
10. **主题变体**：深夜霓虹（默认）/ 雨夜 / 白天（作息联动自动切，A 组 #3）/ 图鉴毛色皮肤（B 组，依赖毛色重映射能力）；主题色板切换走 tailwind v4 CSS 变量（DESIGN.md §7 一色一换）。
11. **delight 落位**：A 组 8 条随 T1 验收（待机小剧场/拍拍差异化/作息联动/真实月相/回滚 grumpy/叼话题 pounce/触觉反馈/LV 升级）；B 组 5 条 T2（邮差动画定级翻转为可做——管线已落锤程序派生，邮差剪影 = 程序骨架资产；attract mode/成就徽章墙（前端派生）/毛色皮肤/霓虹换牌）；C 组 4 条不入本 spec（下一张地图输入）。
12. **PWA**：新增 manifest（名称/图标/主题色 `#1A1C2C`/display standalone/移动优先竖屏）+ 基础 SW 注册；**离线策略与 SW 更新策略不入本 spec**（地图雾区，影响信息架构时再票化）。
13. **spec 修订项（随本 spec 一并提交）**：`.trellis/spec/web/frontend/` 现状纠偏——「直接读 data 目录」改为「CP API 只读消费方（session 鉴权 + SSE）」；设计系统索引补 design-v3 四文档为视觉真相源；CONTEXT.md 已由 PR #182 修订（混合管线/三层质检/视觉基准）。
14. **旧资产处置**：`design-v2/` 本地目录留档不删（未入库，不阻塞）；v2 3D/字体依赖按 stack.md §1 移除；`packages/web/public/pet/` 旧单帧资产重写期间保留（pet-assets 回退与对照用），追平合并时处置建议随收尾票给出。
15. **可访问性与性能红线**（motion.md §5 全收）：只动 transform/opacity/background-position；`prefers-reduced-motion` 停帧；visibilitychange 移除 infinite；中端安卓 60fps（sprite 方案零 JS 运行时天然达标）。

## Testing Decisions

- **只测外部行为**：组件测试断言渲染产物（data-anim/aria/文本/墨条格数），不断言内部实现。
- **Seam（最高且唯一的新 seam）**：数据侧一律在 hooks 层（CP API client）打桩——现有 `useHistory.test.tsx` 为 prior art；新增 `usePetSprite` 的状态机映射（SSE 事件流 → data-anim/data-hungry）做成纯函数，用合成事件序列表驱动测试。
- **sprite 播放器**：用 fixture 资产（A 侧 cat sheet + frames.json）断言帧表解析、steps 动画类名生成、8KB 预算校验、色板出界 0。
- **视觉验收**：每票产出真实浏览器截图（移动 390 + 桌面 1280）走视觉模型评审；动效对照 design-v3/demo.html 基准；宪法四预算作为 review checklist 项。
- **静态闸门**：`pnpm test` / `pnpm lint` / `pnpm typecheck` 全绿；push 前 diff 无 console.log/TODO/敏感信息（AGENTS.md 验收）。

## Out of Scope

- CP/agent 侧任何运行时代码改动（POST /api/walk、petgen 混合管线替换、SSE 新事件）——spec 只给建议，实施需持机人同意后另票。
- B 模型侧冒烟与生图资产替换（缺 ARK_API_KEY；A 侧资产先上线，管线在 web 之外）。
- 音效启用（howler 就位但默认关，音色表/触发点清单是地图雾区）。
- PWA 离线策略与 SW 更新策略细节。
- delight C 组（天气联动/节日彩蛋/邮票收集册/隐藏对话）。
- design-v2 与旧 UI 代码的删除清理（追平合并时的收尾票给处置建议）。
- 多宠物、skill 进化共享、向量库等既有 backlog（CONTEXT.md）。

## Further Notes

- **持机人检查点**：① `ARK_API_KEY`（B 侧冒烟 ≈¥1–3，资产升级用，不阻塞重写）；② 动 CP 侧（POST /api/walk、petgen 替换）动工同意。
- 领养毛色变体（橘/黑/三花）= 程序重映射，图鉴皮肤（B 组）同源；落地节奏随 T2。
- 现有 `.trellis/spec/web/frontend/*.md` 的工程规约（组件/hook/状态/类型/质量）继续有效，重写照旧遵守；本 spec 只补视觉世界与分期。
- 帧表 v2 与播放契约的规范原文在 design-v3/motion.md §3/§3.5；组件规格在 components.md；验收动效演示在 demo.html。
