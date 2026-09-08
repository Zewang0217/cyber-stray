# motion.md · 动效规范（两帧法则）

> 像素世界的动效统一性来自一条纪律：**没有平滑过渡，只有帧切换**。所有动画时长以 60fps 游戏帧计。

## 1. 三条编排原则（与 v2 相同，原样继承）

1. **宠物永远最先动**：任何事件的动效顺序 = 宠物反应 > 事件本体 > 周边布局。
2. **掌机不动，屏内动**：面板/菜单（掌机框架）静止；一切位移发生在屏幕内的游戏层。
3. **一屏一次强调**：同一时刻只有一组主动效；新明信片到达时日志暂停 6 帧。

## 2. 帧数表（60fps）

| 名称 | 帧数 | 实际时长 | 用途 |
|---|---|---|---|
| `f8` | 8 帧 | 133ms | 按钮按下回弹、小徽章出现 |
| `f12` | 12 帧 | 200ms | 明信片落位、对话框出现 |
| `f16` | 16 帧 | 267ms | 页面切换、抽屉开合 |
| `f24` | 24 帧 | 400ms | 猫的 pat/pounce 完整动作 |
| `f48+` | 48+ 帧 | 800ms+ | 行走出屏/回家（伴随步频）|

- 缓动只有两种：`linear`（位移/跑动）与 `steps(n)`（帧切换）。**禁 cubic-bezier 弹性**。
- 闪烁类（NEW 徽章/电源灯/▼）统一 `steps(1)` 1s 循环，全站同频（对齐到整秒，掌机感）。

## 3. Sprite 帧接口（宠物活体）

Aseprite 导出：`cat.png`（spritesheet）+ `frames.json`。CSS 里每个动作 = 一行帧：

```css
.cat .body { image-rendering: pixelated; }
.cat[data-anim="idle"]  { animation: idle  0.8s steps(4) infinite; } /* 4帧循环，含尾巴 */
.cat[data-anim="walk"]  { animation: walk  0.6s steps(4) infinite; }
.cat[data-anim="pat"]   { animation: pat   0.4s steps(2) forwards; }
.cat[data-anim="pounce"]{ animation: pounce 0.4s steps(2) forwards; }
.cat[data-hungry="true"] .eyes { animation: hungryEyes 1.2s steps(2) infinite; }
```

- 状态机由 `usePet()` hook 持有：SSE 状态流 → zustand → `data-anim`/`data-hungry` 属性切换。与 v2 的 Rive 输入表同构：`hunger/boredom/mood` 为数据属性，`pat/pounce` 为触发。
- **帧率锁**：所有 steps 动画的循环时长是 0.8/0.6/0.4s 的公倍数关系，保证全屏动画对齐（掌机同频感）。

### 3.5 帧表 v2 定稿（#169 落锤，2026-09-06）

网格 32×32、脚底接触行 r30；`cat.png` 横排 spritesheet + `frames.json`（manifest v2，`contract: "stray-boy.sprite.v2"`）。两帧法则：次要状态一律 2 帧相位循环，主状态 4 帧。

| data-anim | 帧数 | 时长 | 循环 | 相位内容 |
|---|---|---|---|---|
| `idle` | 4 | 0.8s | loop | 尾相 ×3 + 眨眼 1 帧 |
| `walk` | 4 | 0.6s | loop | 四相位腿（前伸/收拢/后蹬/收拢）|
| `joy` | 2 | 0.4s | loop | 起伏（stretch/crouch）|
| `eat` | 2 | 0.8s | loop | 低头咀嚼两相 |
| `sleep` | 2 | 1.6s | loop | 呼吸起伏（Zzz 由 UI 层出）|
| `think` | 2 | 0.8s | loop | 歪头两相 |
| `celebrate` | 2 | 0.4s | loop | 跳起/落地 |
| `grumpy` | 2 | 1.2s | loop | 甩头/皱眉 |
| `welcome` | 2 | 0.8s | loop | 招手两相 |
| `pat` | 2 | 0.4s | forwards | 下压 d=1 / 深压 d=3（触发）|
| `pounce` | 2 | 0.4s | forwards | 蓄力/腾空（触发，明信片到达编排用）|

- 合计 26 帧 + 独立叠加层 `eyes.png`（饥饿眨眼 2 帧，`data-hungry="true"` 时挂 `.eyes`，1.2s steps(2)）。
- `frames.json` v2 schema：`{ contract, image, frame:{w,h,groundRow}, animations:{<anim>:{from,frames,duration,loop}}, overlays:{hungry:{image,frames,duration}}, palette, provenance }`。
- 生成走混合管线（CONTEXT.md「宠物 sprite 混合管线」）：锚点帧生图/自绘 + 动画帧程序派生；播放器只认本表契约，不感知管线来源。

## 4. UI 层动效（帧切换，无缓动）

| 场景 | 编排 |
|---|---|
| 明信片到达 | 猫 `pounce`（24f）→ 明信片从屏顶"贴"下（f12，无过渡直接换位 + NEW 徽章亮起）→ 日志追加 1 行 |
| 拍拍 | 猫 `pat`（24f）→ 爱心像素 ×3 上飘（f8 each）→ 心情条 +1 格 → 对话框换词 |
| 反馈 👍/👎 | 按钮色翻转（f8）→ 对话框短评 |
| 置顶 | 黄徽章"啪"盖到明信片角（f8 scale 1.3→1）|
| 兴趣进化 | 图鉴条目翻转亮起（f12）→ 方块纸屑（square confetti，80 粒）→ 猫 `pounce` |
| 切 Tab | 旧屏熄灭 2 帧（黑场）→ 新屏点亮（f8）——掌机换卡感 |
| 首次开机 | `▶ NEW GAME` 闪烁 → 猫 walk 入场 → 对话框自我介绍 |

## 5. 性能预算（PWA 移动端，硬性）

- 只动 `transform` / `opacity` / `background-position`（sprite 帧切换）；禁 box-shadow/width 逐帧动画。
- 场景装饰（星、窗、霓虹）全部静态定位，只有招牌和窗灯允许闪烁。
- 单屏并发动效 ≤ 3 组；sprite sheet 单图 ≤ 8KB（1x 网格猫约 2-4KB）。
- 页面不可见时移除所有 infinite animation（`document.visibilitychange`）。
- 全站遵守 `prefers-reduced-motion`：无限动画停帧于第 1 帧，帧切换保留但降为事件触发。
- 目标：中端安卓 60fps；sprite 方案无 JS 运行时，天然达标。
