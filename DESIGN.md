# DESIGN.md - Cyber Stray (赛博街溜子) 视觉与交互规范

## 1. 核心视觉基调 (Visual Identity & Vibe)
- **项目灵魂**: 一只在互联网暗巷中游荡的“自动化信息猎犬”。它既是一个极客工具（Tech/Cyber），又是一个有情绪的电子宠物（Pet/Interactive）。
- **设计风格**: "Cyber-Fluid"（赛博流体）。抛弃传统方正死板的控制台界面，融合黑客帝国的科技感与现代 Web 的极致丝滑。
- **氛围关键词**: 高度个性化、大面积背景动效、磁性交互、极客感、弹簧物理学（Spring Physics）。
- **黑暗模式优先**: 默认渲染暗色主题，亮色主题作为彩蛋或日间切换选项。

## 2. 色彩系统 (Color Palette: Catppuccin)
全面采用 Catppuccin 规范，要求界面色彩柔和但不失科幻感，严禁使用高饱和度刺眼纯色。

### Dark Theme (Catppuccin Mocha) - 默认赛博之夜
- **背景层 (Background)**: 
  - `Base`: #1e1e2e (主背景)
  - `Mantle`: #181825 (卡片与侧边栏)
  - `Crust`: #11111b (沉浸式深色区域/页脚)
- **文本 (Typography)**:
  - `Text`: #cdd6f4 (主要正文)
  - `Subtext`: #a6adc8 (次要文本/注释)
- **品牌与交互色 (Accents)**:
  - `Mauve (霓虹紫)`: #cba6f7 (主色调，用于核心按钮、发光特效)
  - `Blue (电磁蓝)`: #89b4fa (次要强调，用于链接或状态指示)
  - `Red (警报/饥饿)`: #f38ba8 (用于展现 Agent 处于“饥饿”或警告状态)
  - `Yellow (能量/无聊)`: #f9e2af (用于展现“无聊值”或搜索状态)

### Light Theme (Catppuccin Latte) - 日间巡逻
- **背景层**: `Base` #eff1f5 | `Mantle` #e6e9ef | `Crust` #dce0e8
- **文本**: `Text` #4c4f69 | `Subtext` #6c6f85
- **品牌与交互色**: 
  - `Mauve`: #8839ef | `Blue`: #1e66f5 | `Red`: #d20f39 | `Yellow`: #df8e1d

## 3. 字体排版 (Typography)
放弃常规的系统字体，营造“未来科技与代码”交织的质感。
- **标题字体 (Headings)**: `Space Grotesk`
  - 极具科技感和轻微的怪异感（Quirky）。字体权重必须极大（Font-weight: 700/800），字间距（Letter-spacing）设为极紧湊的 `-0.04em`。
- **数据与代码 (Monospace/Stats)**: `JetBrains Mono` 或 `Geist Mono`
  - 用于显示 Agent 的“无聊值”、“饥饿值”、日志输出、时间戳。必须使用其连字（Ligatures）特性。
- **正文字体 (Body)**: `Inter`
  - 保持最高的阅读清晰度，字重 400/500，行高 `1.6`。

## 4. 动画与丝滑交互 (Motion & Interactivity)
**“丝滑”是最高优先级。** 严禁使用生硬的 `linear` 动画，所有状态切换必须具有物理惯性。建议使用 Framer Motion。

- **全局弹簧曲线 (Spring Physics)**:
  - 交互动效统一采用 Spring 动画（配置参考：`stiffness: 400, damping: 25`），让所有点击、悬浮看起来像是有质量的实体。
- **大面积背景动效 (Atmosphere)**:
  - 页面底层必须有一个“游荡”的视觉隐喻。例如：缓慢流动的网格线（Grid Lines）配合跟随鼠标的柔和光晕（Glow Effect），或者类似控制台代码如雨般落下的抽象模糊变体。
- **组件悬浮 (Hover Effects)**:
  - **磁性按钮 (Magnetic Buttons)**: CTA 按钮在鼠标靠近时，需产生向鼠标位置偏移的磁性吸附效果。
  - **玻璃态发光 (Glass & Glow)**: 悬浮卡片时，不仅要轻微上浮（`translateY(-4px)`），其边框必须亮起一圈受限于 Catppuccin 色板的霓虹渐变（如从 Mauve 渐变到 Blue），背景保持 `backdrop-blur-md`。
- **状态感知动效 (State-Driven Animation)**:
  - 当 Agent 处于**饥饿**时，UI 边缘可有轻微的红色呼吸灯脉冲效果。
  - 当 Agent 处于**搜索/游荡**状态时，加载动画不应该是转圈，而应该是雷达扫描（Radar Sweep）或流光飞马（Running Data Streams）。

## 5. 核心组件开发准则 (Component Directives)
- **无聊/饥饿值仪表盘**: 不要使用传统的进度条。尝试使用环形发光进度条，或类似游戏中的“血瓶/能量管”流体填充效果。
- **推流卡片 (Feed Cards)**: 每一条抓取回来的信息卡片，出场时需带有一个错落有致的瀑布流动画（Staggered reveal），从底部滑入并带有 `fade-in` 和轻微的缩放。
- **对话/日志区**: 模拟终端控制台（Terminal），文字出现需要带有类似打字机（Typewriter）的效果，光标一直闪烁。

## 6. AI 编码提示 (Prompt for Cursor/Windsurf)

> "Act as an elite frontend engineer and creative developer. Strictly follow this DESIGN.md. Whenever you create a new component, apply Catppuccin colors, ensure the font pairings (Space Grotesk + Mono), and wrap it in Framer Motion spring animations. Build me a UI that feels alive, fluid, and heavily themed around a cyberpunk digital pet wandering the web."

## 7. 编码时提示

# UI Generation Quality Standards (Kimi K2.6 / Cinematic Level)

When generating Next.js (React) + Tailwind + Framer Motion components, you MUST adhere to these elite frontend standards:
1. **Color Space:** Use `oklch()` for all dynamic colors, gradients, and glows to ensure flawless, human-perceptual color blending. No muddy RGB gradients.
2. **Fluidity:** Use `clamp()` for typography sizes and container paddings. The layout must scale infinitely and fluidly without relying solely on rigid `sm/md/lg` breakpoints.
3. **Motion Orchestration:** Never use basic `opacity-100` transitions. Every entrance must be orchestrated. Use Framer Motion's `staggerChildren` for lists. Add subtle Parallax via `useScroll` on Hero sections.
4. **Glassmorphism & Depth:** Cards should use ultra-refined glass effects (e.g., `backdrop-blur-xl bg-white/5 border border-white/10`) with distinct depth layers.
5. **Typesafe:** Everything must be 100% strictly typed TypeScript. No `any`.