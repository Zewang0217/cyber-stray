# design-v3 ·「像素街区」UI 重设计（尝试 #2）

> 风格：**Pixel / 8-bit**（Styles Vault 05 号档案）
> 品牌参考：**Nintendo 2001**（只借"主机语法"，金属面板材质被否，见下）
> 宠物活体：**像素 sprite 管线**（Aseprite → spritesheet → CSS steps()，不用 Rive，理由见 stack.md）
> 状态：待 review ｜ 上一版（design-v2 贴纸街）已否，保留供对照

## 已定决策

| 决策 | 选择 | 为什么 / 冲突处理 |
|---|---|---|
| 风格 | Pixel 8-bit | 电子宠物是像素的母语：饥饿/无聊值天生是游戏 HUD，游荡是行走帧，推送是寄回来的明信片，兴趣进化是图鉴。比贴纸街多一层"产品机制与视觉语言同构"的运气 |
| 世界名 | **像素街区 · PIXEL BLOCK** | 一座微缩像素夜城，街溜子在楼宇间游荡；整个 PWA 是一台叫 **STRAY-BOY** 的掌机，你是持机人 |
| 品牌参考 | Nintendo 2001（1 个） | ✅ 借它的**主机语法**：把界面当游戏机面板、菜单驱动、HUD 常驻、游戏腔文案。❌ 覆盖：它的斜面金属渐变、Arial Black 平滑字、1px 混合发丝线——全部换成平涂直角 + 像素字。结论：**借语法，换材质**，不冲突 |
| 宠物呈现 | sprite 管线（非 Rive） | 像素世界里向量渲染会破坏像素纯度；Aseprite 出 spritesheet + 帧表 JSON，代码只切帧行（idle/walk/pat/pounce），和 v2 的 Rive 状态机同构——motion.md 的编排原则原样保留 |
| 动效纪律 | **两帧法则** | 所有动画 `steps()` 或线性切换，时长以游戏帧计（8f/12f/16f）；禁止平滑缓动曲线。这是像素世界"动效统一"的唯一办法 |
| 3D | 全部移除 | 同 v2 决策 |

## 与 design-v2 的关系

v2（贴纸街）被否——手作质感成立，但"纸片拼贴"的气质与"赛博宠物"不合。v3 换成像素后，产品机制（状态值/游荡/图鉴/邮件）与视觉语言**同构**了：每个功能在像素游戏里都有现成的母题。动效编排原则（宠物最先动、一屏一次强调、只动 transform/opacity）从 v2 原样继承。

## 文件导航

| 文件 | 内容 |
|---|---|
| [DESIGN.md](DESIGN.md) | 世界宪法：夜城色板、像素字体纪律、六种签名手法、主题变体、禁令 |
| [components.md](components.md) | 组件规范：掌机框架下的全部组件 |
| [motion.md](motion.md) | 动效规范：两帧法则、帧数表、sprite 帧接口、场景编排、性能预算 |
| [stack.md](stack.md) | 依赖选型（含 Rive → sprite 管线变更的理由）|
| [demo.html](demo.html) | 掌机首页 demo：拍拍、让它出门溜达、新邮件到达的完整编排 |
| [preview-desktop.png](preview-desktop.png) / [preview-mobile.png](preview-mobile.png) | 截图 |

## 下一步（review 通过后）

1. DESIGN.md 放到项目根目录替换旧版
2. 按 stack.md 调依赖（移除 three 系与 Rive 计划，加字体包）
3. 像素资产开工：猫（idle 4帧/walk 4帧/pat 2帧/pounce 2帧）+ 场景贴图 + 图标，全部 1x 像素网格
4. 按 components.md 搭组件，demo.html 当动效验收基准
