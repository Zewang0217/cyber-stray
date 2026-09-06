# PROTOTYPE · 宠物 sprite 管线 A/B 对比（wayfinder #168）

> 用后即弃。问题：同一只默认猫（橘猫街溜子）× 同一帧接口（design-v3/motion.md §3），两条管线各出一版并排人眼评审——评审结论喂给「宠物 sprite 管线决策落锤」票。

## 打开方式

双击 `demo.html`（无依赖；字体走 CDN，离线则回退系统字体）。控件：IDLE / WALK / PAT、ZOOM、⏸；点猫 = 拍拍（仅 A 侧有 pat 帧）。

重跑资产（可选）：

```bash
python3 a/render_a.py     # A 侧：校验 a/cat-grids.txt → a/out/cat-a.png + frames.json
python3 a/build_grids.py  # （A 侧画布由段定义生成，改段后重跑上一步）
python3 b/pixelize_b.py   # B 侧：存量生图资产 → b/out/cat-b.png + frames.json
python3 b/derive_pat.py   # B 侧 pat 派生 → b/out/cat-b-hybrid.png + frames-hybrid.json
```

## 两侧是什么

| | A · agent 自绘 | B · 像素风生图 |
|---|---|---|
| 管线 | LLM 字符网格（本目录画布）→ 确定性渲染器（硬校验：行列/字符白名单/脚底线）→ spritesheet + frames.json | 旧管线存量生图资产（`packages/web/public/pet/*.png`，灰白猫 3 变体/状态）→ alpha 腐蚀 → bicubic 32×32 降采样 → 毛色重映射（灰→橘，DESIGN.md §7 皮肤能力）→ 17 色硬量化 → 底中基线对齐 |
| 产出 | idle 4 / walk 4 / pat 2，1.1KB | idle 3 / walk 3 / pat 2（派生），2.5KB 混合版 `cat-b-hybrid.png` |
| 色板 | 7/17 色，出界 0（结构性保证） | 5/17 色，出界 0（量化保证） |

## 为什么 B 侧 pat 是"派生"的

旧管线 9 状态契约（`packages/shared/src/pet.ts` 的 `PET_STATES`：idle/walk/joy/eat/sleep/think/celebrate/grumpy/welcome）里**没有 pat**——pat/pounce 是 design-v3/motion.md §3 新帧接口才有的动作，所以 `packages/web/public/pet/` 原料里就没有。B 侧的 pat 2 帧由 `b/derive_pat.py` 从 idle-1 base 程序下压派生（d=1/3，非生图直出）——这同时是「**B 生图出 base + A 式程序派生出动画帧**」混合管线的小型实证：生图负责"好看的单帧"，程序派生负责"帧间一致"。

## 诚实边界（评审前必读）

1. **B 侧模型侧未跑**（本机无 `ARK_API_KEY`）：#167 §4.2 的「像素锚点帧 img2img + 组图一致性」是 B 的关键假设，本页缺证；B 的上限应据此打折读。补冒烟 ≤10 张 ≈ ¥1–3。
2. B 原料是旧管线**灰白猫**，橘色来自确定性毛色重映射——重映射本身是皮肤管线能力，但「生图直接出橘猫」未测。
3. A 侧 walk 侧影为 v3 草稿（偏几何），拍板后可在画布上继续精修，分钟级。
4. B 的 3 帧/状态是**表情变体**而非动画相位——这是旧管线契约（frames=1）的事实，不是本原型的缺陷。

## 背景文档

- 票：[#168](https://github.com/Zewang0217/cyber-stray/issues/168)（prototype）· 地图 [#165](https://github.com/Zewang0217/cyber-stray/issues/165)
- 研究：`research/agent-pixel-drawing` 分支 `docs/research/agent-pixel-drawing.md`（A 侧）· `research/imagegen-pixel-sprite` 分支 `docs/research/imagegen-pixel-sprite.md`（B 侧）
- 契约：`design-v3/motion.md` §3/§5 · `design-v3/DESIGN.md` §2（14 色）
