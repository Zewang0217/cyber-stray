# 像素风生图管线能力盘点（issue #167）——B 侧「Seedream 管线改良」实施研究

> 问题：把 #166 推荐乙（保底/对照路径）**做实**——「现有 Seedream 生图管线改良：锚点帧 img2img + 确定性后处理量化对齐 + 豆包 QC 加帧间一致性项」落到现有代码上，给出模型能力证据、prompt 策略、后处理与质检的具体改造点、成本量级与失败模式清单。
> 与 #166 的分工：#166 是 A/B 路径盘点（A 侧 = LLM 字符网格 + 程序骨架派生，为首选）；本文**只做实 B 侧**，不再重复泛泛对比。代码与文档不一致处逐条点名（§2.3）。
> 结论先行：B 侧基础设施全部在位（petgen 状态机 / pet-sheet.py / 两层质检 / admin 模型热切换），改造集中在四件事——**像素锚点帧先行、prompt 像素纪律加固、新增确定性 pixelize 后处理（块估计 → 32×32 下采样 → 14 色量化 → 基线对齐）、QC 三层化（结构层加色板/假像素检查 + 语义层换锚点参考加帧间一致性 + 新增程序层 dHash 漂移检测）**。全量 12 帧成本 ≈ ¥5–11/套（重试含内），约为 A 侧 LLM token 路径的 20–100 倍，但配额 2 套/月下绝对值可忽略——成本不是 B 侧否决项，帧间一致性才是，缓解手段见 §4/§6。

---

## 1. 对接面（B 侧产物必须满足的既有契约）

| 约束 | 来源 | 内容 |
|---|---|---|
| 帧接口 | design-v3/motion.md §3 | `cat.png`（spritesheet）+ `frames.json`；idle 4 帧 0.8s / walk 4 帧 0.6s / pat 2 帧 / pounce 2 帧，CSS `steps()` 播放；饥饿眼睛是**独立 `.eyes` 元素** 2 帧叠加层（可单独出小图，不占主体帧） |
| 帧数复核 | design-v3/components.md §游戏屏 | 「像素猫 sprite（站立 idle 4 帧 / 行走 4 帧 / 拍拍 2 帧 / 扑向 2 帧）」——与 motion.md 一致，合计 12 帧 |
| 网格 | #166 推荐甲 §实施方案 | 32×32（walk 需腿部位移；16×16 为降级实验项）；脚底线固定（第 30 行为地面接触行） |
| 14 色纪律 | design-v3/DESIGN.md §2 | 14 个 hex 即全宇宙（sky `#1A1C2C`、bld-far `#29366F`、bld-near `#3B5DC9`、window/hi `#F7D51D`、street `#333C57`、curb `#566C86`、star `#F4F4F4`、ok `#92CC41`、bad `#E76E55`、act `#209CEE`、neon `#FF004D`、paper `#F8F5F5`、ink `#212529`、panel `#2C3136`；window 与 hi 同值故 15 个 token 14 色）。**注意：猫本体色不在 14 色内**——量化色板 = 14 色 ∪ 猫本体色组（3–4 色，实施票拍板），否则猫无法着色 |
| 体积/性能 | motion.md §5 | sprite sheet 单图 ≤ 8KB（1x 网格猫约 2–4KB）；只动 transform/opacity/background-position；`image-rendering: pixelated` |
| 复用现状 | ADR-0006 / ADR-0001 | 生图 = Seedream 5.0（Ark 同步 API）、参考锁角色不训 LoRA、图文分离、两层质检结构 |

## 2. 现状管线事实（代码摘录）

### 2.1 petgen 管线（宠物 IP 生成，#94，控制面进程）

状态机（`packages/control-plane/src/petgen/processor.ts`）：
`spec_submitted → concept_generating → awaiting_confirmation（用户确认锚点）→ generating_states → qc → done | failed`。

| 环节 | 实现 | 关键事实 |
|---|---|---|
| 概念图 | `prompt.ts buildConceptPrompt` → `ark.ts generate` → `splitter.normalizeConcept` | spec 纯文本 + 风格预设 + 绿幕约束（`纯绿色背景(#00FF00)`）+ 禁文字水印；归一 512 透明 PNG（绿幕色度抠图 → 整身裁剪缩放，`pet-sheet.py --single`） |
| 参考图 | `processor.ensureReference` → `pet-sheet.py --flatten` | 概念图 → **384px 白底 JPEG**（`referenceFrame: 384`，`index.ts:127`），data URL 传 Ark `image` 字段 |
| 多状态 | 策略阶梯 quad → nine → per（`processor.runStrategy`） | quad = 3 张 2x2（每张 3 状态 + 右下空格，prompt 要求「右下角必须留空(纯绿色)」）；**空位指令不顺从检测**：`emptyCells === 0` 即判失败升级策略（`processor.ts:279`） |
| 切分 | `splitter.splitGrid` → `pet-sheet.py --grid --cells --report` | 行带/列簇投影检测（白线 + 绿幕双掩码），**检测失败均分兜底**（warning）；内容占比 82% 归一 + 底中对齐 → 256×256 帧，LANCZOS 缩放 |
| 结构 QC | `structure-qc.ts` → `qc-structure.py` | 256×256 方格 / alpha 透明底 / 内容占比 ≥20%，单行 JSON，脚本未上报的状态显式失败 |
| 语义 QC | `vision.ts createVisionQc` | **智谱 GLM-4V-Flash（免费）**，OpenAI 兼容 chat/completions，双图输入（概念图参考 + 状态帧），Zod 外的严格 JSON 解析（容忍围栏）；baseUrl 可配 |
| 重试语义 | `processor.advanceQc/advanceGenerating` | 结构不过不浪费视觉调用；失败 = 单状态重试（`pendingStates`）+ 策略升级；`maxBatchRetries=2`、`maxQcRetries=2` 超限 → 整体 failed（改 spec 重来，不占配额） |
| 交付 | `processor.finalize` | 概念图 + 9 状态 PNG 落 `data/tenants/<sub>/pet-assets/`，manifest 原子写，**每状态 frames=1（单帧静态 + 播放器程序微动画）** |
| 配额/用量 | `quota.ts` / `usage.ts`（#129） | 月配额 2 套（`CP_PETGEN_MONTHLY_QUOTA`，`config.ts:103`）；生图/视觉调用成功记用量 |
| 模型配置 | `app-config.ts`（#131） | 默认 `doubao-seedream-5-0-260128`（`config.ts:100`），admin 可热切 `doubao-seedream-4-5-251128` / `doubao-seedream-4-0-250828`（`MODEL_CANDIDATES`）；生图 size 固定 `'2K'`（`index.ts:113`） |
| 队列节奏 | `index.ts:131` | tick 间隔 5s，单 tick 单任务，租户内串行 |

### 2.2 表情包管线（agent worker 侧，与本文相关的部分）

`packages/agent/src/meme/ark.ts` 同款 Ark 客户端；worker 短命进程读 env（`MEME_IMAGE_MODEL`/`MEME_VL_MODEL`，`app-config.ts` 注释）——若 B 侧像素管线模型换档，agent 侧 env 需同步，此为两处调用面。

### 2.3 代码与文档不一致（点名，不改动，供勘误）

1. **`gridSize` 是死配置**：`types.ts:112` 声明、`index.ts:128` 赋 `'1024*1024'`，但 `processor.ts`/`ark.ts` 均不读取——实际尺寸由 `index.ts:113` 的 `ArkImageOptions.size: '2K'` 决定（ark.ts 工厂入参）。死字段应删或接通，避免误以为改它生效。
2. **ADR-0006 自相矛盾**：标题写「豆包视觉质检」、Consequences 写「质检…变为豆包视觉（≈¥0.01/张）」，但正文决策 2 与代码实况是**智谱 GLM-4V-Flash（免费）**（`vision.ts:8,16`；账号未开通豆包视觉，模型 ID 直调 404）。`prompt.ts:68` 注释「语义质检 prompt（豆包视觉）」同样过期。
3. **模型 ID / 尺寸与 ADR-0006 不符**：ADR 写模型 `doubao-seedream-5-0-lite`、尺寸「沿用 1024×1024」；代码默认 `doubao-seedream-5-0-260128`（无 `-lite` 后缀）、size `'2K'`——`ark.ts:13` 注释「Seedream 5.0 无 1K 档，最小 2K」。以代码为准，ADR 需勘误。
4. **CONTEXT.md 未回填 ADR-0006**：「生图统一契约」仍写「qwen-image 参考模式」、「两层质检…语义层（qwen-vl）」——生图实为 Seedream 5.0、语义 QC 实为 GLM-4V-Flash。
5. **帧契约缺口**：现 manifest 契约每状态 `frames:1`（对齐 web `PetStateSpec` 单帧）；B 侧需要 frames>1（idle 4/walk 4/pat 2/pounce 2）——需要 manifest v2 或独立的像素宠物 sprite 契约（`cat.png` + `frames.json`），不能直接复用现 petgen manifest 形状。

### 2.4 切分脚本对像素目标的适配度

`packages/web/scripts/pet-sheet.py` 现有资产：绿幕抠图（`chroma_key_green`）、双掩码网格检测、82% 内容归一、底中对齐、256 帧——全部可复用；但三处与「真像素」目标冲突：① LANCZOS 缩放产生抗锯齿边（假像素）；② 无调色板量化（14 色无从保证）；③ 归一化逐帧独立缩放，跨帧基线只是「底中」对齐，无共享脚底线锁定。这就是 B 侧后处理要新增的部分（§4.3）。

## 3. 模型能力证据

### 3.1 Seedream 5.0 Lite（现役默认）

- 2026-02-13 发布，火山引擎 Model ID `seedream-5-0-260128`，官方 $0.035/张（比 4.5 的 $0.040 便宜约 12%），3–5s 出图，原生最大 3072×3072（2K/3K 档）[ofox 深度解读]。与 `ark.ts` 注释「5.0 无 1K 档，最小 2K」吻合。
- **结构化指令遵从强**（新增视觉推理能力）：「3×3 这种结构化要求，拓扑对的概率高很多」——对 B 侧的网格/多帧布局指令是利好 [ofox]。
- **多图参考一致性弱于 4.5**：4.5 主打多参考主体锁定（最多 10 张参考图），5.0 Lite 把参考一致性让位给了结构化遵从与成本 [ofox]。
- 写实质感弱，「像素风/草没关系」[ofox]——像素风是安全的风格域。
- 计费除生图外有 web search 激活费 $0.0069/次（模型自主触发才收）[ofox]——管线 prompt 不应触发联网（关注项，实测确认）。
- ⚠️ 不确定性标注：官方一手文档（volcengine docs）JS 渲染无法抓取正文，以上为第三方测评；价格以[方舟模型价格页](https://www.volcengine.com/docs/82379/1099320)为准。仓库内 ADR-0006 记 Lite ≈ ¥0.4/张（高于第三方 $0.035≈¥0.25，取区间 ¥0.25–0.4 计算成本）。

### 3.2 Seedream 4.0 / 4.5（备选档，已在 MODEL_CANDIDATES）

- 4.0 起统一文生图与编辑架构，多参考图输入 + 参考一致性 + 组图生成 [ByteDance Seed 官方]；4.5 参考图上限 10 张、主体锁定更强 [51CTO]。
- **组图生成**：`sequential_image_generation` + `sequential_image_generation_options.max_images`（兼容实现标注参考图数 + 生成数 ≤ 15，`max_images` [1,15]）——组内主体/风格一致，按生成张数计费 [Ark 图片生成教程][金山云兼容文档]。这是 B 侧多帧一致性的免费增益（§4.2）。
- `guidance_scale` [1,10]（文本权重，越高越贴 prompt——布局顺从旋钮）；`seed` 可固定复现 [Ark ImageGenerations API]。
- 参考图格式 JPG/JPEG/PNG ≤5MB [方舟接口文档]；另一产品线文档标最小 600×800——本管线 384px 白底 JPEG 在 Ark 实测可用（spike 在跑），但加大参考输入是低风险改进项。
- 开源实证：[perfectpixel-studio] 直接基于 `seedream-4-0-250828` 做像素动画工作室——「Seedream + 确定性后处理」路线已被开源跑通（其量化细节见 §4.3）。

### 3.3 能力小结（对 B 侧的含义）

1. 没有任何 Seedream 档位有「像素专用模式」，输出必是高分辨率假像素（AA 边 + 调色板溢出）——**像素纪律只能由后处理保证**，模型侧只求「角色对、姿态对、布局对」。
2. 参考一致性分层：**4.5 > 5.0 Lite**——锚点帧 img2img 阶段优先测 `doubao-seedream-4-5-251128`（admin 热切换即可，零代码）；5.0 Lite 适合单帧重试与成本敏感路径。
3. 布局顺从分层：5.0 Lite 结构化遵从 > 4.x——若仍走网格布局，Lite 反而占优；若走组图逐帧，4.5 占优。

### 3.4 备选模型/工具（替换余地，均不进在线管线）

| 选项 | 形态 | 对 B 侧的意义 |
|---|---|---|
| [Retro Diffusion](https://retrodiffusion.ai/) | 商业专用像素模型 + API | 最强原生像素纪律（真网格输出、9 参考图锁角色）；[pixel-art-fixer](https://github.com/Retro-Diffusion/pixel-art-fixer) 开源修假像素工具可直接借鉴进后处理；引入外部付费依赖，仅作对照 |
| FLUX.1 Kontext dev | 开放权重（ComfyUI 本地） | 参考一致性编辑公认强 [ComfyUI 官方教程]；12B 级，产机 2C4G 跑不动（与 ADR-0001 否决 LoRA 同理），只能作为本地产资产的一次性工具 |
| Qwen-Image-Edit-2511 | 开放权重 | 多参考融合 + 角色一致性 [Qwen 官方博客]；20B 更重，且社区报 pixel drift 需重连 VAE 输入规避 [Reddit PSA]——不满足在线管线 |
| Seedance（图生视频） | Ark 同供应商 | walk cycle 保底路径（§4.5）；注意 1.0 lite i2v/t2v 旧版本有下线公告，用前确认在售版本 [下线公告] |

## 4. B 侧实施方案建议

### 4.1 总体形状

沿用 petgen 状态机与两层质检骨架（`ImageGenerator`/`VisionQc`/`StructureQc`/`Splitter` 接口不动），在 `stylePreset === 'pixel'`（预设已存在，`shared/src/pet.ts:92`）时启用像素分支：

```
概念图（现链路）→ 用户确认
  → 像素锚点帧：概念图 img2img「风格化到 32×32 像素画放大版」+ 归一（用户可再确认）
  → 逐状态帧：组图/逐帧 img2img（参考 = 像素锚点帧）
  → pixelize.py 确定性后处理（§4.3）
  → 三层质检（§4.4）→ 失败单帧重试 → spritesheet + frames.json 落盘
```

### 4.2 模型与 prompt 策略

1. **模型**：锚点帧与首批组图用 `doubao-seedream-4-5-251128`（一致性优先，`MODEL_CANDIDATES` 已含）；单帧重试用 `doubao-seedream-5-0-260128`（便宜 12% + 结构化遵从）。admin 热切换天然支持 A/B 对照。
2. **组图优先于网格**：多状态帧用 `sequential_image_generation`（一次调用出 N 张组内一致帧）替代 2x2/3x3 网格——网格切分在 256→32 下采样后会把格线残影放大成噪点，且格分辨率不足（ADR-0001 当年否决 3 帧 27 格的理由对像素风更成立）；组图按张计费无额外成本。quad 网格保留为组图不可用时的成本回退。
3. **prompt 像素纪律加固**（`prompt.ts` pixel 分支）：现 pixel `promptFragment`（`复古像素风,16-bit 游戏精灵…`）只有风格没有纪律，需追加：「真像素块，每块纯色，硬边，无抗锯齿，无渐变，无模糊，调色板限制 N 色，单角色全身」；绿幕约束与 NEGATIVES 沿用。
4. **布局守卫沿用**：组图 `max_images` 与网格空格同构——返回张数/帧数不符即显式失败（推广 `emptyCells === 0` 的检查模式，禁兜底）。
5. **参数**：`guidance_scale` 调高（布局顺从）；同组帧固定 `seed`；`watermark: false` 已有。

### 4.3 确定性后处理（新增 pixelize.py，或 pet-sheet.py 加 `--pixel` 模式）

流水线（每帧）：

1. **抠图**：复用 `chroma_key_green`（绿幕 alpha 提取）；**加 1px alpha 腐蚀**（erode）——绿渗边在 32×32 上会变成噪点色块（失败模式 B6）。
2. **块尺寸估计**：统计同色 run-length 众数估出「生图像素块」的实际边长（perfectpixel-studio 的成熟手法，实测 7,834 色 → 12 色锐利点阵）；估不出（块大小混乱）→ 判该帧不可量化，直接进重试。
3. **下采样**：downscale-only 到 32×32 整数块网格（perfectpixel 用 CatmullRom 降采样后 snap；简单实现 = 按块取众数色/中心采样）；禁放大再缩小。
4. **14 色量化**：RGBA 逐像素最近邻到「14 色 + 猫本体色组」固定色表（自写 <40 行，保 alpha）；注意 Pillow 的坑——RGBA→P 的 `convert()` 会忽略 `dither`/`palette` 参数 [Pillow 文档][Stack Overflow]，务必 `dither=NONE` 或自写映射（dithering 是像素画灾难）。pngquant/libimagequant 可作交叉验证（dither 0）[pngquant lib]。
5. **基线对齐**：共享脚底线（如统一第 30 行为接触行）+ 水平底中对齐——`normalize()` 的底中对齐只有「每帧各自贴底」，跨帧漂移照旧；改为全帧统一 baseline 后再排布（失败模式 B5 的根治，[aispritesheet] 的 Integer Pixel Lock 同款）。
6. **排布导出**：按 motion.md 帧表排 `cat.png` 横排 sheet + `frames.json`（idle 4 / walk 4 / pat 2 / pounce 2，含 dur）；体积校验 ≤8KB（14 色 32×32×12 帧 PNG 必然远低于，校验兜底即可）。

### 4.4 质检链路改造点

| 层 | 现状 | 改造 |
|---|---|---|
| 结构层 `qc-structure.py` | 256×256 / alpha / 占比 ≥20% | 像素分支加四项（参数化，非像素路径不受影响）：① 尺寸 32×32（或 1x 基准）② **色板出界像素数 = 0**（14 色 + 本体色白名单）③ **假像素残留 = 0**（以 32×32 基准格放大后格内第二色计数）④ **跨帧基线一致**（各帧脚底行索引相同） |
| 语义层 `vision.ts` | 双图（概念图 + 状态帧）查状态/一致性/无文字/无畸形 | ① 参考图从高分辨率概念图换成**像素锚点帧**（跨域对比判「一致」不可靠）② `buildQcPrompt` 加帧间一致性项：角色/体型/配色与锚点一致 + 地面线对齐 + 姿态符合状态名——双图输入接口已支持，零接口改动 |
| 程序层（新增，零 API 成本） | 无 | dHash 感知哈希 + 64-bin RGB 直方图（perfectpixel-studio 手法）：锚点帧 vs 各帧汉明距离阈值内判漂移，离群帧先于视觉调用被拦截；leave-one-out 抓批量漂移 |

重试语义：沿用「失败单帧重试 + 不占配额」；组图模式下失败帧以组内最优帧为新参考单独重生成（aispritesheet 结论「重生成优于编辑已有 sheet」）。

### 4.5 walk cycle 保底（图生视频抽帧）

逐帧 img2img 的漂移累积已被开源实证（#166 引 chongdashu：逐帧与整 sheet 均 fail，walk cycle 唯一可行 = 图生视频抽帧）。B 侧保底：Seedance i2v（首帧 = 像素锚点帧，prompt 固定镜头不动/角色走动）→ 抽 4 帧重 → 走同一 pixelize 后处理。注意 1.0 lite 旧版本下线公告，选型时确认在售版本；该路径每动画一条视频，成本见 §5。

## 5. 成本量级（¥，2026-09 时点）

单价依据：Seedream 5.0 Lite $0.035/张 ≈ ¥0.25（ofox）～ ¥0.4（ADR-0006 记账口径），取 **¥0.25–0.4/张** 区间；Pro 1K ¥0.3 / 2K ¥0.6（heyuan110，2026-07 上线报价）；GLM-4V-Flash 免费（ADR-0006 实测）；程序层 dHash/结构 QC 零 API 成本。⚠️ 官方价格页 JS 渲染未抓到正文，成交价以方舟计费页与产机账单复核。

| 方案 | 生图调用 | 全量成本（重试系数 1.5–2 含内） |
|---|---|---|
| **B 侧 12 帧全量**（1 概念 + 1 像素锚点 + 12 帧，组图/逐帧按张计） | 14 张 | 原始 ¥3.5–5.6 → **¥5–11** |
| B 侧 9 状态 ×3 帧扩展（若未来恢复帧条契约，27 + 2 张） | 29 张 | ¥11–23 |
| walk 保底：Seedance i2v（仅 walk 一条） | 1 条视频（5s 级） | lite 档约 ¥1–3/条（第三方 $0.0065/千tokens 折算；版本待确认，需实测） |
| 对照：A 侧 LLM 字符网格（#166 推荐甲） | 0 次生图 | 12 帧 <25K tokens × DeepSeek 输出 ¥4.5–8/M ≈ **¥0.1–0.3** |

**判断**：B 侧 ≈ A 侧的 20–100 倍，但配额 2 套/月/租户下月增上限 ≈ ¥22/租户，绝对值不构成否决项；真正的分摊大头是**重试率**（一致性差 → 重试系数恶化），所以 §4.4 的程序层免费质检前置（拦截离群帧再烧 vision/生图）是成本控制的关键杠杆，而非压单价。

## 6. 已知失败模式清单（B 侧视角，编号接 #166 的 F1–F8）

| # | 失败模式 | 机理 | 缓解（对应 §4 改造点） |
|---|---|---|---|
| B1 | 参考漂移（多帧越长越不像） | 5.0 Lite 参考一致性弱于 4.5；img2img 逐帧漂移累积（F4 同源） | 锚点帧用 4.5；组图 sequential 保组内一致；固定 seed；程序层 dHash 拦截 |
| B2 | 假像素 Mixels（AA 边/半色调） | 模型输出高分辨率连续色调，无像素专用模式（F7 同源） | 块估计 → 整数块下采样 → 量化；结构层 ③ 检查 |
| B3 | 调色板溢出（出界色/中间色） | 模型不知道 14 色纪律 | 量化白名单硬映射；结构层 ② 出界像素 = 0 拒收 |
| B4 | 量化后格内杂色（块估计失准） | 生图块大小不一/网格漂移 | run-length 众数估块；估不出 → 判不可量化进重试 |
| B5 | 基线漂移（foot slide，走路像滑行） | 每帧独立归一贴底，脚底位置逐帧浮动（F5 同源） | 共享 baseline 锁定；结构层 ④ 检查 |
| B6 | 绿幕渗边成噪点 | 色度抠图 halo 在 32×32 下采样后可见 | 抠图后 alpha 腐蚀 1px 再量化 |
| B7 | 下采样细节消失（眼睛/胡须不可辨） | 32×32 上五官占比极低 | 锚点帧 prompt 强调大轮廓高对比五官；语义 QC 查「可辨认」 |
| B8 | 组图组内漂移 | sequential 一致性非 100% | dHash leave-one-out 抓离群帧 → 单帧重生成 |
| B9 | 帧数/格数不符 | max_images/网格布局顺从失败（F3 同源） | 布局守卫显式失败（推广 emptyCells 模式）+ 策略阶梯沿用 |
| B10 | sheet 超 8KB | 理论不可能（14 色 32×32），防回归 | 导出时体积校验兜底 |
| B11 | Lite web search 误触发计费 | 5.0 Lite 联网激活费 | prompt 避免时效性措辞；用量侧盯 `$0.0069/次` 项 |

## 7. 下一步（原型票拆法建议）

1. **纯确定性层先行**（可单测、零成本）：pixelize.py（抠图/块估计/下采样/量化/基线）+ qc-structure.py 像素四项 + 程序层 dHash——用现成任意生图先验后处理，不依赖模型选型结论。
2. **模型冒烟**（≤10 张）：像素锚点帧 + 4.5 组图 vs 5.0 Lite 组图各出一轮 12 帧，过 pixelize 后按 B1–B10 清单打分定主力模型。
3. **接入 petgen**：`stylePreset === 'pixel'` 分支 + manifest v2（frames>1 + `frames.json`）；web 播放侧对接 motion.md 帧接口属另一票。
4. **A/B 对照验收**：与 #166 推荐甲同帧接口、同验收（motion.md 帧表 + 8KB 预算 + 浏览器实测 60fps），用真数据裁决主力路径。

## 参考来源

外部（官方一手标注为「官方」；volcengine 文档页 JS 渲染无法抓正文，其参数/价格经搜索快照交叉确认，标注不确定性）：

- [ofox — Seedream 5.0 Lite vs 4.5 深度解读（2026）](https://ofox.ai/zh/blog/seedream-5-0-lite-vs-4-5-deep-dive-china-2026/)（5.0 Lite 发布时间/ID/价格/能力分层）
- [heyuan110 — Seedream 5.0 Pro 实操与选型（2026-07-09）](https://www.heyuan110.com/zh/posts/ai/2026-07-09-seedream-5-pro/)（Pro 定价 ¥0.3/1K、¥0.6/2K）
- [ByteDance Seed — Seedream 4.0 官方页](https://seed.bytedance.com/zh/seedream4_0)（统一架构/参考一致性/组图，官方）
- [火山方舟 — Seedream 4.0-5.0 提示词指南](https://docs.volcengine.com/docs/82379/1829186)（官方，图生图技巧）
- [火山方舟 — 图片生成教程](https://docs.volcengine.com/docs/82379/1824121)（官方，API 调用与组图）
- [火山引擎 — ImageGenerations API](https://api.volcengine.com/api-docs/view?action=ImageGenerations&version=2024-01-01&serviceCode=ark)（guidance_scale [1,10]、seed，官方）
- [火山方舟 — 模型价格](https://www.volcengine.com/docs/82379/1099320) / [价格文档](https://docs.volcengine.com/docs/82379/1544106) / [模型下线公告](https://docs.volcengine.com/docs/82379/1350667)（官方计费口径与 lite 下线）
- [金山云 — 豆包 Seedream 兼容文档](https://docs.ksyun.com/documents/45132)（参考图 + 生成数 ≤15、max_images [1,15]）
- [gykim80/perfectpixel-studio](https://github.com/gykim80/perfectpixel-studio)（Seedream 4.0 + 确定性后处理管线：共享调色板 median-cut、run-length 块估计、dHash 漂移检测、校正重生成）
- [aispritesheet — Fix Wobbly Sprite Animation](https://www.aispritesheet.com/ai-sprite-sheet/fix-wobbly-sprite-animation)（基线锁定/整数像素锁/重生成优于编辑）
- [Retro Diffusion](https://retrodiffusion.ai/) / [pixel-art-fixer](https://github.com/Retro-Diffusion/pixel-art-fixer) / [Runware 案例研究](https://runware.ai/blog/retro-diffusion-creating-authentic-pixel-art-with-ai-at-scale)（像素专用模型对照）
- [FLUX.1 Kontext（bfl.ai）](https://bfl.ai/models/flux-kontext) / [ComfyUI Kontext dev 教程](https://docs.comfy.org/tutorials/flux/flux-1-kontext-dev)（开放权重参考一致性编辑）
- [Qwen-Image-Edit-2511 官方博客](https://qwen.ai/blog?id=qwen-image-edit-2511) / [Reddit PSA：Qwen Edit pixel drift 规避](https://www.reddit.com/r/StableDiffusion/comments/1pv96a2/psa_eliminate_or_greatly_reduce_qwen_edit/)
- [Pillow Image 文档](https://pillow.readthedocs.io/en/latest/reference/Image.html)（RGBA→P 忽略 dither/palette 的坑）/ [pngquant libimagequant](https://pngquant.org/lib/)（dither 0 无抖动量化）/ [Stack Overflow：PIL 固定色板](https://stackoverflow.com/questions/12645492/pil-dithering-desired-but-restricting-color-palette-causes-problems)
- [DeepSeek API 定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)（A 侧 token 成本对照）

仓库内（一手代码/文档）：

- `packages/control-plane/src/petgen/processor.ts`、`ark.ts`、`prompt.ts`、`splitter.ts`、`structure-qc.ts`、`vision.ts`、`types.ts`
- `packages/control-plane/src/index.ts`（装配：size '2K'、重试参数、配额）、`src/config.ts`、`src/app-config.ts`（模型热切换）
- `packages/web/scripts/pet-sheet.py`、`packages/control-plane/scripts/qc-structure.py`
- `packages/shared/src/pet.ts`（9 状态注册表 / pixel 预设 / manifest 契约）
- `docs/adr/0001-content-generation-pipeline.md`、`docs/adr/0006-image-provider-volcano-ark.md`
- `CONTEXT.md`「内容生成与宠物生命周期」、`design-v3/DESIGN.md` §2（14 色）、`design-v3/motion.md` §3/§5、`design-v3/components.md`
- `docs/research/agent-pixel-drawing.md`（#166 结论，分支 `research/agent-pixel-drawing`）
