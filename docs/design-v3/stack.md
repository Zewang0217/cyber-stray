# stack.md · 依赖选型

> 立场与 v2 相同：**不引成品皮肤组件库**，只收无头行为基座 + 能力库 + 字体。所有可见面按 components.md 手写。

## 1. 移除

| 包 | 理由 |
|---|---|
| `three` / `@react-three/*` / `postprocessing` / `@gltf-transform/cli` | 旧 3D 世界遗产，像素世界不需要 |
| `@fontsource/caveat` / `@fontsource/eb-garamond` | 旧世界字体 |

## 2. 新增：能力库

| 包 | 用途 | 为什么是它 |
|---|---|---|
| `motion` | 动效编排 | 只用它管 AnimatePresence（明信片进出）与 layout 推挤；**所有 tween 一律 `ease: linear`**，弹性交给帧切换。与两帧法则不冲突的用法写进 motion.md |
| `@formkit/auto-animate` | 列表 | 明信片堆叠推挤 |
| `vaul` | 移动抽屉 | 历史明信片/日志存档 |
| `sonner` | 通知 | PixelToast 的行为基座 |
| `canvas-confetti` | 领养/进化 | `shapes:['square']` 像素方块纸屑，仅两处 |
| `howler` + jsfxr 音效（可选，默认关） | 8-bit 音效 | 拍拍"喵"、贴邮"啪"、开机音。游戏世界里音效的权重比 v2 高一级 |

**与 v2 的关键差异：不引入 `@rive-app/react-canvas`。** Rive 是向量渲染，做像素风要么关抗锯齿要么逐帧重绘，两头不讨好；像素活体的正解是 sprite sheet + CSS `steps()`（零运行时、天然 pixelated、状态机同构地映射到 `data-anim` 属性）。motion.md §3 是完整帧接口。

## 3. 新增：字体

| 包 | 角色 |
|---|---|
| `@fontsource/press-start-2p` | Display/HUD/按钮（英文·数字）|
| `@fontsource/fusion-pixel-12px-proportional-sc` | 中文像素短标签（12px 点阵；npm 无官方 `fusion-pixel-font` 聚合包，2026-09-06 定 fontsource 自托管 SC 变体，与其它字体同一构建链路）|
| `@fontsource/vt323` | 日志/数字 |
| `@fontsource-variable/noto-sans-sc` | 长内容正文（可读性铁律）|
| `@fontsource/ibm-plex-mono`（保留）| mono 日期签（明信片左上/SAVE SLOT/时间轴）|

## 4. 保留

`next` / `react` / `tailwindcss v4`（CSS 变量承载主题变体）/ `@radix-ui/react-*`（无头行为）/ `clsx` / `tailwind-merge` / `react-markdown`（明信片摘要）。

## 5. 明确不引入

| 类别 | 理由 |
|---|---|
| 成品组件库（MUI/Ant/shadcn 默认皮）| 大众脸与品质感 binding 冲突 |
| Rive | 向量渲染与像素纯度冲突（本版最大选型变更）|
| 图表库 | 图鉴自绘像素墨条 |
| Lottie / GSAP / lenis / tsparticles | 同 v2 理由：与两帧法则冲突或纯属浪费包体 |
| NES.css | 它是参考实现不是依赖——我们要自己的色板与组件；只"借鉴其 box-shadow 技法" |
