# Agent 自绘像素的技术路径盘点（issue #166）

> 问题：让 agent 直接绘制像素宠物 sprite（motion.md §3 帧接口：idle 4 帧 / walk 4 帧 / pat 2 帧 / pounce 2 帧），有哪些**已验证可行**的技术路径？为 A/B 原型票铺路。
> 结论先行：**首选「LLM 字符网格 + 确定性渲染器 + 程序骨架出帧」（P1+P4 组合），保底「现有 Seedream 生图管线 + 确定性量化对齐后处理」（P3 改良）**。逐像素 tool-calling 与 box-shadow 代码生成不适合做动画路径，理由见 §3/§5。

---

## 1. 对接面（我们要满足的既有契约）

来自 design-v3 与现有管线，是所有路径的硬约束：

| 约束 | 来源 | 含义 |
|---|---|---|
| 14 色固定色板，禁止发明新色 | DESIGN.md §2 | 生成结果必须逐像素落在 14 个 hex 上；三层（游戏/UI/语义）不许互借色 |
| sprite 帧接口 idle 4 / walk 4 / pat 2 / pounce 2，`cat.png` + `frames.json`，CSS `steps()` | motion.md §3 | 产出必须是 spritesheet PNG + 帧表 JSON，不是逐张散图 |
| 动画只能动 `transform`/`opacity`/`background-position`，**禁 box-shadow 逐帧动画**；sprite sheet ≤ 8KB | motion.md §5 | box-shadow/SVG 代码路径无法承载动画，只能出静态资产 |
| 拒绝向量渲染（Rive），正解 = sprite sheet + CSS steps | stack.md §2 | 任何"先生成高分辨率再缩放"的方案都要处理抗锯齿/假像素 |
| 现有内容生成管线：AI 生图 → 切分 → 两层质检 → 落目录；Seedream 5.0 Lite + 豆包 vision QC | CONTEXT.md「内容生成管线」 | P3 路径的基础设施已在位 |
| `pet-sheet.py`：绿幕抠图 → 网格检测切分 → 82% 归一化 → 底中对齐 256×256 帧 | packages/web/scripts/pet-sheet.py | 现有管线的切分/对齐/参考图输入（`--flatten`）逻辑可直接复用；"检测失败均分兜底"的 warning 说明生图网格经常对不齐——这正是帧间不一致的实证 |

## 2. 路径盘点

### P1 · LLM 输出字符网格（每像素一个字符）→ 确定性渲染 PNG

**做法**：把 14 色板编码成 13 个前景字符 + `.`（透明）。LLM 逐行输出 32 行字符串，渲染器脚本做确定性校验后转 PNG + frames.json。

**实证**：

- [Fraser/pico-8-games（HuggingFace 数据集）](https://huggingface.co/datasets/Fraser/pico-8-games/blob/main/README.md)：PICO-8 卡带的 spritesheet 以 **hex 字符串无损表示**（128×128、固定 16 色板），是现成的"LLM 可训练/可生成像素文本表示"先例。PICO-8 的 16 色固定板与本项目 14 色板同构。
- [Spritesheet To P8SCII（Lexaloffle 论坛）](https://www.lexaloffle.com/bbs/?tid=49536)：sprite ↔ 字符串互转在 PICO-8 生态是原生操作，工具链成熟。
- [spriteforge](https://github.com/francesco-sodano/spriteforge)：两阶段 AI 管线（base 图 → 参考条带 → 逐行动画网格生成），最后经**确定性 grid-to-PNG 渲染**组装，配 **LLM 门控校验 + 重试升级**。"网格文本 → 确定性渲染 → 校验重试"这套结构与 P1 完全同构，已被跑通到 game-ready 输出。
- 反面证据（表示对齐难度）：[Learning to Draw ASCII Improves Spatial Reasoning in LLMs](https://openreview.net/pdf/fe203ec6c95a36fc16ad271f88f45186e49a9dd8.pdf) 表明 ASCII 网格对齐是 LLM 空间推理弱项 → 必须配程序校验，不能裸信输出。

**特点**：14 色纪律由字符表**结构性保证**（出界字符在渲染器直接拒绝）；像素是真像素无量化损失；token 成本极低（32×32 一帧 ≈ 32 行 × 32 字符，约 1–2K token，12 帧全量 < 25K token，数分钱级）；渲染器一次写好终身确定性可测试。

### P2 · LLM 写代码出像素画（box-shadow / SVG / canvas）

**做法**：LLM 直接产出渲染代码——单 `<div>` 大 `box-shadow` 偏移列表、`<rect>` 阵列 SVG（`shape-rendering: crispEdges`）或 canvas 绘制脚本。

**实证**：

- [CSS-Tricks: Fun Times With CSS Pixel Art](https://css-tricks.com/fun-times-css-pixel-art/)：box-shadow 像素画技法的经典综述，配套生成器众多（如 [Ludvig Lindblom 的 generator](https://css-tricks.com/fun-times-css-pixel-art/) 文内链接）。
- [icaromol/free-css-sprite-generator](https://github.com/icaromol/free-css-sprite-generator)：本地像素编辑器 + CLI，把图转成纯 CSS box-shadow sprite（无 raster/canvas/SVG）——网格 → box-shadow 的确定性转换已有现成工具。
- [robdegeorge/pixelartengine](https://github.com/robdegeorge/pixelartengine)：像素编辑器 + **MCP server 供 AI 辅助绘制**，输出单 div box-shadow——"AI 产代码出像素"已有开源先例。
- DESIGN.md §4 签名手法 5 本身就钦定"图标 = 像素画（box-shadow 或 crispEdges SVG）"——**静态资产层面该路径与宪法兼容**。

**特点与硬伤**：渲染是确定性的，与 P1 同构（代码只是另一种编码）；但 box-shadow 每像素一段冗长，token 成本远高于字符网格；**致命伤是动画**——motion.md §5 明令"禁 box-shadow 逐帧动画"，且 box-shadow 拼不出 `background-position` 可切的 spritesheet。因此 P2 只能作为**静态图标/邮票（16×16，DESIGN.md §6）的渲染后端**，不能承担 12 帧宠物动画。

### P3 · 生图模型直出 sprite sheet（含图生视频抽帧）

**做法**：Seedream 类模型按绿幕/网格约束生图（现状）或逐帧 img2img、或图生视频抽帧，再切分后处理。

**实证**：

- 现状 `pet-sheet.py` 就是这条路径的 qwen-image 版本，且其"检测失败均分兜底"的兜底逻辑本身就是帧间不一致的日常实证。
- [The AI Game Development Lie（GameLab）](https://gamelabstudio.co/blog/why-ai-cant-make-game-ready-spritesheets)：直接让图像模型"生成一张 spritesheet"得到的帧**不一致、不可用于游戏动画**。
- [chongdashu/ai-game-spritesheets](https://github.com/chongdashu/ai-game-spritesheets)：九阶段 GPT-Image 工作流的开源实证，明确结论——"Image gen ≈ 20% of the work"；**逐帧 img2img 与整张 sheet 一次生成全部失败**，walk cycle 唯一可行解是**图生视频（Seedance）出 90 帧视频再抽 8–12 帧**；锚点图 + 黑白像素网格约束 + 中性姿势（剥离特效）是一致性来源；AI 输出是"Mixels（假像素）"，需降采样量化。
- [Fix Wobbly Sprite Animation（aispritesheet.com）](https://www.aispritesheet.com/ai-sprite-sheet/fix-wobbly-sprite-animation)：失败模式四大类（尺寸/位置漂移、地面线 foot slide、细节闪烁、姿态无推进）与修复手段（共享画布基线、Integer Pixel Lock、逐帧检查、**重生成优于编辑已有 sheet**）。
- 学术上限参照：[Sprite Sheet Diffusion（arXiv:2412.03685）](https://arxiv.org/abs/2412.03685) 专门微调 Animate Anyone（ReferenceNet + Pose Guider + Motion Module，152 序列/916 帧配对数据），一致性大幅超越通用生图（in-sample SSIM 0.659 vs vanilla 0.330），但**细节仍会丢**（手中道具消失）、Stage 2 过拟合、训练要 42GB 显存——自训路线对本项目体量不现实。
- 商业 SOTA 参照：[PixelLab](https://www.pixellab.ai/) 的 [Animate with skeleton](https://www.pixellab.ai/docs/tools/animate-with-skeleton)（骨架逐帧控制 + inpainting + init image 锁定不变区域）与 [Rotate](https://www.pixellab.ai/docs/tools/rotate)（单参考图出 8 方向），支持 16×16/32×32 标准尺寸与 API——其一致性全部来自"参考图条件化 + 确定性骨架控制"，印证"锁定参考 + 程序控制"路线，而非纯文本 prompt。

**特点**：画质上限最高（插画级）；但每帧烧钱、14 色纪律无法由模型保证（必须后处理量化）、帧间一致性只能靠工程缓解（chongdashu 的"唯一可行 = 图生视频"既是希望也是成本）。

### P4 · 程序骨架 + LLM 填充（模板/基帧锁定派生）

**做法**：锁定一帧 base（手绘或 P1 静态生成），其余帧由程序对 base 做确定性变换派生（身体上下 1px、腿相位交替、尾巴摆动），LLM 只负责 base 设计与差异微调。

**实证**：

- [Universal LPC Spritesheet Character Generator](https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/)：LPC 社区成熟开源——全部部件预绘、程序按 walk/idle 等模板组合成 spritesheet，**零 AI 也保证逐帧一致**，是"模板锁定"路线的黄金标准（idle 4 帧/walk 4 帧正是其内建规格）。
- [PixelLab 骨架动画](https://www.pixellab.ai/docs/tools/animate-with-skeleton)：商业验证同构思路——每帧骨架姿态是确定输入，生成只负责"填肉"。
- 两帧法则（DESIGN.md §4）下 idle/walk 本来就是小幅相位差循环，程序刚性变换的"一致性最强"优势被放大，"创意上限低"劣势被缩小。

**特点**：一致性天花板（同源派生，物理上不可能漂移）；质量上限受变换规则创意限制；工程量中等（每个动作写一套变换规则，但 pat/pounce 只有 2 帧，代价小）。

## 3. 路径对比表

| 路径 | 质量上限 | 帧间一致性 | 单次成本 | 工程量 | 14 色纪律 | 动画适配（motion.md §3/§5） |
|---|---|---|---|---|---|---|
| **P1** 字符网格 → 确定性渲染 | 中（SwordsBench 级静态 2–3/3，动画未解） | 中—靠参考帧 + 校验器 | 极低（文本 token，分币级） | 低（渲染器 < 200 行） | 结构性保证 | ✔ 直接出 spritesheet + frames.json |
| **P2** LLM 写 box-shadow/SVG 代码 | 中（静态；与 P1 同构） | 同 P1 | 低—中（token 冗长） | 低 | 结构性保证 | ✘ **禁 box-shadow 逐帧动画**，拼不出 spritesheet；仅静态图标 |
| **P3** 生图模型/图生视频 | 高（插画级，但假像素需量化） | 低—中（整 sheet/逐帧 img2img 已证伪；图生视频抽帧可行但贵） | 高（每帧烧图费/视频费） | 中（复用 pet-sheet.py + 新增量化对齐） | ✘ 必须后处理量化 | ✔ 切分后可出 spritesheet |
| **P4** 程序骨架派生 | 中（受变换规则创意限制） | **最高**（同源派生，不可能漂移） | 极低（base 一帧的成本） | 中（每动作一套规则） | 继承 base 帧 | ✔ 天然对齐帧表 |

> SwordsBench 出处：[Lj Miranda, "Draw me a swordsman: Can tool-calling LLMs draw pixel art?"](https://ljvmiranda921.github.io/notebook/2025/07/20/draw-me-a-swordsman/)。其"逐像素 tool-calling"形态（每像素一次工具调用，经 [diivi/aseprite-mcp](https://github.com/diivi/aseprite-mcp) 驱动 Aseprite CLI + Lua 脚本）实测：静态 32×32 最高 Opus 4 得 2.5/3；**四帧挥砍动画任务全员 ≤ 2/3**，比例失真、帧间不一致；token 成本爆炸（32×32 = 上千次工具调用）。作者自评"可能不是 tool-calling LLM 的好用例"。→ **P1 应采用"整帧文本一次输出"，明确否决逐像素工具调用形态。**（Aseprite CLI + Lua 脚本自动化本身是可行的工具链，若走 Aseprite 后处理路线可复用。）

## 4. 失败模式清单（跨路径，已知会崩的形态）

| # | 失败模式 | 崩在哪条路径 | 证据 | 缓解 |
|---|---|---|---|---|
| F1 | 逐像素 tool-call：token 爆炸 + 动画帧全员崩 | 逐像素工具调用形态 | SwordsBench Task2 全员 ≤ 2/3 | 改整帧文本输出（P1） |
| F2 | ASCII 网格对齐/计数错误（行列不齐、字符出表） | P1 | Learning to Draw ASCII…（LLM 空间推理弱项） | 渲染器硬校验（行列数、字符白名单）+ 失败重试（spriteforge gate 模式） |
| F3 | 整张 sheet 一次生成 → 帧间尺寸/位置漂移，不可用 | P3 | GameLab；chongdashu（明确否定）；pet-sheet.py 均分兜底 warning | 拒绝此形态；走锚点帧派生 |
| F4 | 逐帧 img2img → 漂移逐帧累积 | P3 | chongdashu（"every other approach fails"） | 图生视频抽帧，或 P4 程序派生 |
| F5 | 地面线漂移（foot slide，行走像滑动） | P3 | aispritesheet wobble 指南 | 共享 baseline 对齐（pet-sheet.py `normalize()` 底中对齐已有） |
| F6 | 细节闪烁（腰带/发丝逐帧变形） | P3、P1 | aispritesheet；Sprite Sheet Diffusion（道具消失） | 角色设计简单化（宠物本体小而简）；不变区域锁定（PixelLab inpainting 思路 → P4 程序只变换肢体） |
| F7 | Mixels 假像素 + 色板出界 | P3 | chongdashu（"true pixel art" 之辩） | 下采样到整数网格 + 最近邻量化到 14 色 |
| F8 | 姿态无推进（循环像抖动不像走路） | P3 | aispritesheet | P4 的骨架相位定义天然规避 |

## 5. 推荐：给 A/B 原型票的路径

### 推荐甲（首选）· P1 + P4 组合："LLM 字符网格出 base 帧 + 程序骨架出动画帧"

**输入输出**：

- 输入：角色卡（名字/性格/毛色 token，来自领养仪式）+ 14 色字符表（`--sky` 透明用 `.`，其余 13 色各配一字符）。
- 输出：`cat.png`（spritesheet，idle 4 / walk 4 / pat 2 / pounce 2 横排）+ `frames.json`——与 motion.md §3 帧接口逐字对齐；渲染器为确定性脚本（Node/Python，复用 `getDataPath()` 落盘约定）。

**实施方案草图**：

1. **网格锁定**：32×32（walk 需要腿部位移，比 16×16 稳；16×16 可作降级实验项）。prompt 里固定网格行数与脚底线（如第 30 行为地面接触行），LLM 输出 32 行定长字符串。
2. **调色板锁定**：字符表即色板，渲染器白名单校验，出界即拒绝——14 色纪律结构性成立（F7 免疫）。
3. **base 帧生成**：LLM 一次输出 idle 第 1 帧整帧文本（禁止逐像素 tool-call，F1 免疫）；渲染器校验（F2 免疫）后落为角色锚点。
4. **帧间一致性**：优先 **P4 程序派生**——idle 剩余 3 帧 = base 的头/尾相位变换，walk 4 帧 = 腿部相位模板替换（LPC generator 同款思路），pat/pounce 各 2 帧 = 前倾/腾空的刚性位移；base 帧正文像素不动，F6/F8 天然免疫。差异微调帧（如 pounce 蓄力压缩）再让 LLM 以"帧 N−1 网格在上下文中 + 差分指令（只改 X 区域）"生成，仍过校验器。
5. **确定性后处理**：校验通过 → 字符矩阵 → PNG（1x）→ 按 motion.md 帧表排布横排 sheet → 输出 `frames.json`；体积预算天然满足（32×32×12 帧 PNG ≪ 8KB）。
6. **验收门**：可加一层 vision QC（豆包已在位）看 base 帧语义（"这是一只坐着的猫"），不通过则带错误反馈重试（spriteforge gate 模式）。

**为什么首选**：成本几乎为零（纯文本 token）；14 色与网格纪律由表示法结构性保证，不依赖模型自觉；真像素无假像素问题；渲染器确定性 → 可 Vitest 单测；LLM 调用天然是 agent ReAct 循环里的一个 tool，契合"agent 自绘"的主轴；动画一致性由 P4 程序派生兜住，不赌模型。风险是 base 帧静态美感上限（SwordsBench 2–3/3"可用但平庸"）——但两帧法则 + 32×32 小网格本就是复古审美，可接受，且 aesthetically 由 prompt 精修迭代即可。

### 推荐乙（对照/保底）· P3 改良："现有 Seedream 管线 + 锚点参考 + 确定性量化对齐"

**实施方案草图**：

1. **锚点帧先行**：沿用 #94 概念图归一（`pet-sheet.py --single`）产出角色锚点（ADR-0001 资产）。
2. **参考帧输入**：逐状态生成时把锚点帧经 `--flatten`（白底 JPEG，qwen-image input.image 链路已验证）作 img2img 参考，缓解（非根除）F4。
3. **约束生成**：prompt 加黑白网格底约束（chongdashu 技法）+ 绿幕背景（现有抠图链路复用）。
4. **确定性后处理新增**：下采样到 32×32 整数网格 → 最近邻量化到 14 色板（F7）→ 底中基线对齐（`normalize()` 已有，F5）→ vision QC 加"帧间一致性"检查项（豆包比对相邻帧）。
5. **walk cycle 的 B 方案**：若逐帧生成一致性不过关，按 chongdashu 验证走图生视频（Seedance）抽 8–12 帧再量化对齐——这是生图路径下唯一被开源实证可行的动画形态，但成本最高。

**为什么保底**：基础设施全在位（Seedream、豆包 QC、pet-sheet.py、CONTEXT.md 内容生成管线），是零新增依赖的演化路线，且画质上限最高；适合作为原型票的对照组——两条路径同一帧接口、同一验收（motion.md 帧表 + 8KB 预算 + 浏览器实测），跑完即可用真数据裁决。

### 明确不推荐

- **逐像素 tool-calling**（SwordsBench 形态）：token 爆炸 + 动画帧全员崩（F1）。
- **box-shadow/SVG 代码作为动画路径**（P2 全量）：motion.md §5 禁 box-shadow 逐帧动画；仅保留其作为静态图标/邮票渲染后端的既有角色（DESIGN.md §4/§6）。
- **自训扩散模型**（Sprite Sheet Diffusion 复现）：42GB 训练 + 配对数据标注，与本项目体量不匹配；PixelLab API 可作未来商业对照项但引入外部付费依赖，不进 A/B。

## 6. 小网格 + 锁色板的可行性小结（票面第 4 问）

- **16 色固定板 + 小网格是 LLM 像素表示的成熟先例**：PICO-8（16 色、16×16 sprite）的 hex/P8SCII 字符串表示已有训练数据集（Fraser/pico-8-games）与生态工具链；本项目 14 色、32×32 只是把先例参数化。
- **静态单帧 32×32 已被多个模型达到"可辨认"水平**（SwordsBench：Opus 4 静态 3/3 创造力 / 2/3 正确性），动画帧是共同短板 → 一致性靠表示锁定 + 程序派生，不靠模型自觉。
- **14 色 ≠ 限制而是助攻**：字符表编码把"色板纪律"从生成问题变成校验问题；PICO-8 16 色限制正是其 sprite 美学与工具链简洁的来源。

## 参考来源

- [Lj Miranda — Draw me a swordsman: Can tool-calling LLMs draw pixel art?](https://ljvmiranda921.github.io/notebook/2025/07/20/draw-me-a-swordsman/)（SwordsBench 实测）
- [diivi/aseprite-mcp](https://github.com/diivi/aseprite-mcp)（Aseprite CLI + Lua 脚本的 LLM 接入先例）
- [francesco-sodano/spriteforge](https://github.com/francesco-sodano/spriteforge)（参考条带 → 像素网格 → 确定性渲染 + LLM gate）
- [chongdashu/ai-game-spritesheets](https://github.com/chongdashu/ai-game-spritesheets)（GPT-Image 九阶段；图生视频抽帧为唯一可行动画形态）
- [Universal LPC Spritesheet Character Generator](https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/)（程序化模板拼装黄金标准）
- [Sprite Sheet Diffusion（arXiv:2412.03685）](https://arxiv.org/abs/2412.03685)（学术一致性上限与代价）
- [Fraser/pico-8-games（HuggingFace）](https://huggingface.co/datasets/Fraser/pico-8-games/blob/main/README.md)（16 色 hex 字符串表示的 LLM 先例）
- [Spritesheet To P8SCII（Lexaloffle）](https://www.lexaloffle.com/bbs/?tid=49536)（sprite ↔ 字符串互转）
- [PixelLab — Animate with skeleton / Rotate / API](https://www.pixellab.ai/docs/tools/animate-with-skeleton)（商业 SOTA：参考图条件化 + 骨架控制 + inpainting）
- [Fix Wobbly Sprite Animation（aispritesheet.com）](https://www.aispritesheet.com/ai-sprite-sheet/fix-wobbly-sprite-animation)（失败模式与确定性后处理清单）
- [The AI Game Development Lie（GameLab）](https://gamelabstudio.co/blog/why-ai-cant-make-game-ready-spritesheets)（整 sheet 直出的不可用性）
- [CSS-Tricks — Fun Times With CSS Pixel Art](https://css-tricks.com/fun-times-css-pixel-art/) / [robdegeorge/pixelartengine](https://github.com/robdegeorge/pixelartengine)（box-shadow 技法与 AI 辅助先例）
- [Learning to Draw ASCII Improves Spatial Reasoning in LLMs（OpenReview）](https://openreview.net/pdf/fe203ec6c95a36fc16ad271f88f45186e49a9dd8.pdf)（ASCII 网格对齐难度）
- [PixelBytes: Catching Unified Representation for Multimodal Generation（HAL）](https://hal.science/hal-04683349v2/file/PixelBytes__Catching_Unified_Representation_for_Multimodal_Generation.pdf)（Pokémon 动画帧序列上的统一生成先例）
- [SD-πXL: Generating Low-Resolution Quantized Imagery via Score Distillation](https://www.researchgate.net/publication/384769852_SD-piXL_Generating_Low-Resolution_Quantized_Imagery_via_Score_Distillation)（低分辨率量化图像生成）
- [A Missing Data Imputation GAN for Character Sprite Generation（arXiv:2409.10721）](https://arxiv.org/html/2409.10721v1)（Pokémon sprite GAN 先例）
