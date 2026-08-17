# DESIGN.md - Cyber Stray 维多利亚自然博物图鉴视觉规范

> 旧 Cyber-Fluid 规范（Catppuccin + Space Grotesk + 玻璃态 + 弹簧动画 + CyberGrid/MouseGlow）已废弃作反参考。本规范是新视觉世界的唯一真相源。

## 1. 核心视觉基调 (Visual Identity & Vibe)

- **项目灵魂**: 一只在云端自主游荡的活物。它活在**一本会动的维多利亚自然博物图鉴**里——不是 Tamagotchi 萌系掌机,不是赛博朋克霓虹,是一本泛黄铜版画图鉴,宠物是图鉴页面上**会动的铜版画插画**(像《神奇动物在哪里》的会动照片)。
- **「赛博」的来源**: 「赛博」= 云/在线(宠物活在云端、自主运行、实时同步),不是 cyberpunk。科技感来自「图鉴里的画活了」+ 云端活物,不来自霓虹/终端/金属质感。
- **设计风格**: "Living Engraving"(会动的铜版画)。抛弃传统仪表盘堆卡片,也抛弃赛博朋克霓虹堆叠,回到 19 世纪自然博物图鉴的 line engraving craft。
- **氛围关键词**: 做旧纸张、铜版排线、手写采集笔记、活着的插画、云端同步、博物品质感、细节打磨。
- **亮色优先**: 维多利亚图鉴的物理场景 = 书桌/书房/博物馆标本柜的灯光,纸是亮的(纸本身反光),墨是暗的。**纸色底 + 墨色墨是天然 light-first**,不做 dark 默认。主题系统可有「夜读/烛光」变体(纸色压暗 + 墨色加深),但不作默认。
- **品质感 binding**: 独特设计、有个性、用心制作、细节打磨到位是产品价值的一部分。所有 craft 细节(铜版排线纹理、手写注解、sprite 帧动画、状态反应、轻交互反馈、排版间距)都要打磨,不可大众化廉价处理。

## 2. 色彩系统 (Color Palette)

**配色策略: Restrained** — 纸色底 + 墨色 + 一个生命色。不引入饱和色 carry 大面积(冲淡 line craft)。避开 AI rut accent(terracotta/signal-red)。


### 基础调色板 (默认「日间图鉴」主题)

所有颜色用 `oklch()` 确保感知均匀。纸色和墨色是铜版画传统的做旧/单色,不是纯白纯黑。**文本用色必须 ≥4.5:1 对比度**(craft-floor),图形/光晕用色 ≥3:1。

- **纸色 (Paper, 底)**: `oklch(0.92 0.03 85)`。主背景、卡片底、图鉴页面。
- **深纸色 (Deep Paper, 分层)**: `oklch(0.88 0.03 85)`。卡片分层/侧栏(映射旧 `--color-mantle`/`--color-surface`)。
- **墨色 (Ink, 正文/线条)**: `oklch(0.28 0.02 75)`。正文、铜版画线条、主标题。
- **淡墨色 (Faded Ink, 次要文本)**: `oklch(0.50 0.03 75)`。次要文本/注解(≥4.5:1,build 后从 0.55 加深)。
- **琥珀 (Amber, 图形/光晕)**: `oklch(0.62 0.13 75)`。圆点/呼吸光/边框示能(≥3:1,仅图形)。
- **文本琥珀 (Amber Ink, 文字用生命色)**: `oklch(0.48 0.12 75)`。文本语境的生命色(≥4.5:1,build 中新增)。
- **状态色**: 警告/错误 `oklch(0.45 0.13 75)`(映射旧 `--color-danger`);低精力=淡墨;心情差=墨色。不引入红/黄/绿/蓝饱和色块。
- **旧语义 token 映射**(组件渐进迁移): `--color-base`→paper、`--color-mantle/surface`→deep-paper、`--color-text`→ink、`--color-subtext/overlay/accent-blue`→faded-ink、`--color-accent`→amber、`--color-danger/warning`→state-warn/amber-ink、`--color-success`→ink。**禁止再用** `bg-primary`/`border-border`/`ring-primary`(旧代码残留的未定义 token,已清除)。

**选字原则**: 从维多利亚图鉴传统的 face 里选,不是从 AI default serif(Cormorant/Crimson/Newsreader)里选。避开 impeccable 校准警告的训练数据默认 face。

- **标题字体 (Headings)**: `EB Garamond` 或 `Cardo`
  - 维多利亚图鉴页面的衬线标题传统。Garamond 系是图鉴/古籍印刷的真实历史 face,不是 AI default display serif。字重 400/500/600(图鉴标题不用极重,靠字号和字距)。
- **手写注解 (Collector's Notes)**: `Caveat` 或 `Kalam`
  - 采集者手写笔记/拉丁名旁注。手写体,用于状态读数标注、采集者备注、时间地点注解。不是正文。
- **等宽读数 (Mono Stats)**: `IBM Plex Mono` 或 `JetBrains Mono`
  - 用于状态数值(无聊/精力/心情/脾气)、时间戳、游荡步数、推送 ID。等宽 + 连字特性,保证数字对齐。
- **正文字体 (Body)**: `EB Garamond` 400
  - 正文用标题字族的常规字重,保持图鉴一致质感,不引入第二个 sans body face。

**字距/行高**:
- 标题 letter-spacing: `-0.01em`(衬线标题微收紧,不用 Space Grotesk 的 `-0.04em`)。
- 正文 line-height: `1.7`(图鉴阅读节奏比旧 1.6 略松)。
- 等宽数字 line-height: `1.4`(紧凑读数)。

## 4. 动画与交互 (Motion & Interactivity)

**「活着」是最高优先级。** 宠物 sprite 必须在某处活着(idle 动画 + 状态反应 + 轻交互反应),这是 PRODUCT.md 硬约束。

- **宠物 sprite 素材管线 (AI 生图精灵图,whale-girl 式)**:
  - 素材不是手写 SVG(手绘上限低,已废弃)。管线:AI 生图(qwen-image,3x3 网格 sprite sheet,纯绿 #00FF00 底锁抠图)→ Python 切分(`scripts/pet-sheet.py`:色度抠图/行带列簇检测/内容占比 82% 归一/底对齐/256px 方帧)→ 每状态一条横排 PNG(`public/pet/<state>.png`)。
  - manifest = `lib/pet-sprite.ts`(状态/帧数/时长契约);播放 = **JS setInterval 直接设 `backgroundPosition`**(不用 CSS steps 动画——合成器会周期性渲染空白帧,实测废弃);夜读主题用 `brightness` 滤镜适配暗纸;`prefers-reduced-motion` 时静止首帧。
  - 当前状态(9,参考图锁定同一只猫):idle(待机)/ walk(游荡)/ joy(开心)/ eat(进食)/ sleep(休息)/ think(思考)/ celebrate(庆祝)/ grumpy(不爽)/ welcome(打招呼)。
  - 状态优先级:拍拍(joy,用户主动)> 事件 flash > state/mood 推导。
  - 事件驱动(SSE worker 生命周期):pet_ready→welcome / worker_started→think(游荡中)/ worker_succeeded→eat(吃到内容)/ worker_failed·timeout·retry→grumpy。
  - 心情映射:playful/excited→joy;grumpy/emo→grumpy;lazy→sleep;其余→idle。
  - 重生成素材:改提示词 → qwen-image 出图(参考图锁定角色)→ `python3 scripts/pet-sheet.py <raw> --grid --states <a,b,c> --out public/pet`;帧数变了才需要同步 `lib/pet-sprite.ts`。
  - 新状态走同一管线(3×3 网格一行一状态),播放器零改动。
- **入场动画 (Staggered Reveal)**:
  - 推送流卡片: 从底部滑入 + fade-in + 轻微缩放,错落 stagger(旧 DESIGN.md 的 staggered reveal 保留,换质感)。
  - 状态读数更新: 数字「被修订」的微动画(像采集者擦改笔记)。
  - 兴趣节点变化: 宠物自己改的兴趣节点带呼吸光示能(生命色 amber glow),与用户改的区别可见。
- **过渡曲线**:
  - 不用硬 `linear`。用 Framer Motion spring(stiffness: 300, damping: 28——比旧 400/25 更柔,贴合图鉴的「翻页」质感而非「弹球」)。
  - 页面过渡: 模拟翻页(curve ease-in-out,0.4s)。
- **背景动效 (Atmosphere)**:
  - 旧 CyberGridBackground(网格雨) + MouseGlow(鼠标光晕)废弃。
  - 新背景: 做旧纸张纹理(SVG noise/feTurbulence,静态或极慢漂移),不要赛博朋克网格雨。
  - 可选: 图鉴页面的多层 parallax(吸收自 challenger multiplane cel——前景植物/中景宠物/背景风景,用 SVG 不用 raster),但要克制不冲淡「页面」感。
- **状态感知动效 (State-Driven)**:
  - 无聊: sprite 烦躁微动(不是 UI 边缘红光脉冲——旧 PulseBorder 废弃)。
  - 游荡/搜索中: sprite 游荡动画,不用转圈也不用旧 RadarScan(旧 DESIGN.md 的 radar sweep 在图鉴世界不原生)。

## 5. 核心组件开发准则 (Component Directives)

- **宠物 sprite 区 (Living Illustration)**: 图鉴页面的核心区域,宠物铜版画插画在此活着。不是 StatCard 不是 gauge。idle 动画常驻,状态/轻交互/推送触发反应动画。这是 signature interaction。
- **状态读数 (Field Notes)**: 无聊/精力/心情/脾气做成**图鉴页边的测量标注/采集者笔记里的数字**,不是环形 CircularGauge 也不是进度条。等宽数字 + 手写注解(如「Boredom: 42 — 似有焦躁」)。
- **推送流 (Feed Cards)**: 采集者笔记里新贴的发现条目。staggered reveal(从底部滑入 + fade + 轻缩放)。每条带反馈入口(👍/👎/顶话题,做成图鉴批注样式)。轻交互入口(拍拍/夸)在宠物 sprite 区,不在推送流。
- **兴趣图谱 (Taxonomy)**: 采集品类整理。宠物自己改的兴趣节点带生命色呼吸光(示「这是它自己改的」,自进化可见)。权重可视化用铜版排线密度/手写权重数字,不用环形 gauge。
- **游荡足迹 (Collection Map)**: 地图上的观察点路径(吸收自 challenger zoo guide map 的 lobe 拓扑,但用铜版画质感不用平涂色块)。时间回放游荡路径。
- **导航 (Sidebar)**: 桌面(lg+)= 固定目录栏(铜版画边框 + 衬线标题 + 手写拉丁名页码);移动 = 顶栏 + 左滑抽屉目录(同一 NavList,主区 `pt-14 lg:pt-0`)。双端均重,不允许横向溢出。**活动项标记 = 琥珀呼吸圆点**(替换 icon 位置),不用 border-l 侧边条(craft-floor 侧边 accent 违规)。琥珀圆点标记系统全局一致:在线指示、活动导航、宠物自改兴趣节点、活着示能。
- **主题切换 (Theme Toggle)**: 数据驱动主题系统(`lib/themes.ts` 是唯一主题色数据源,组件/CSS 零主题色字面量)。四档循环:日间图鉴(默认,:root)/ 夜读烛光 / 春·嫩竹纸 / 秋·枫纸。应用方式:非默认主题写 html 内联样式(layout 内联脚本防首帧闪烁),`html[data-theme]` 驱动宠物滤镜等主题专属规则。新增主题 = THEMES 加一个对象,零 CSS/组件改动。day 的值只存在于 :root(无 JS 兜底)。
- **按钮 (Buttons)**: 主按钮 = 墨底纸字(letterpress 活版印刷感)+ hover 琥珀底阴影 `shadow-[0_2px_0_0_var(--c-amber)]`;次按钮 = 纸底 + 铜版细边框 + hover 琥珀边框。圆角 `rounded-sm`。
- **打字机 (TypewriterText)**: 琥珀光标(`bg-accent` → amber),像钢笔书写。用于宠物自我介绍逐行浮现。

## 6. 组件处置(build 后实况)

### 已删除

- `CyberGridBackground.tsx` / `MouseGlow.tsx` / `PulseBorder.tsx` / `RadarScan.tsx` / `HeroStage.tsx` / `GlassCard.tsx` / `MagneticButton.tsx` — 赛博特效/玻璃态组件。
- `StatCard.tsx` / `CircularGauge.tsx` / `MoodBadge.tsx` / `EntropyGauge.tsx` / `InterestBars.tsx` / `InterestHistoryChart.tsx` — 功能内联到 `page.tsx` 的 FieldNote 读数行与兴趣列表。

### 已重写

- `FeedCard.tsx` — 采集者笔记发现条目(stagger reveal 保留,人格化文案=手写旁注,反馈按钮=图鉴批注)。
- `Sidebar.tsx` — 图鉴目录(桌面固定栏 + 移动顶栏/抽屉)。
- `AdoptionFlow.tsx` / `PetIntro.tsx` — 图鉴领养登记 + 新标本自我介绍(PetSprite 首次露面)。
- `ThemeToggle.tsx` — 日/夜图鉴切换(html.night)。

### 保留

- `TypewriterText.tsx` — 琥珀光标,宠物自我介绍逐行浮现。

### 新增

- `PetSprite.tsx` — 会动的铜版画插画(signature interaction)。
- `FieldNote.tsx` — 采集者笔记读数(手写标签 + 等宽数字)。
- `PaperTexture.tsx` — 纸张纹理背景层。


## 7. 编码标准

1. **Color Space**: `oklch()` 用于所有动态颜色/渐变/光晕(保留旧标准)。
2. **Fluidity**: `clamp()` 用于字号和容器 padding(保留旧标准)。
3. **Motion**: Framer Motion spring 编排,不用基础 opacity transition(保留旧标准,换 spring 参数)。
4. **Glassmorphism 废弃**: 旧 `backdrop-blur-xl bg-white/5 border border-white/10` 全废弃。新卡片 = 铜版画边框(line engraving SVG border) + 纸色底 + 微做旧纹理。
5. **Typesafe**: 100% 严格 TypeScript,无 `any`(保留旧标准)。
6. **Web 只读契约**: Web 端绝不写 agent 数据,只读 + 反馈/轻交互 POST(产品硬约束)。
