#!/usr/bin/env python3
# PROTOTYPE（#168 B 侧，用后即弃）：既有生图资产 → 确定性 pixelize 后处理 → 32×32 spritesheet。
# 对应 #167 §4.3 的简化实施：分帧 → alpha 腐蚀 → 8×8 块众数下采样 → 毛色重映射（灰→橘，
# 即 DESIGN.md §7 图鉴皮肤的管线能力）→ 17 色硬量化 → 底中基线对齐 → 横排 sheet。
# 模型侧（锚点帧 img2img / 组图）无 ARK key 未跑——本脚本只证确定性后处理层。
# 用法：python3 pixelize_b.py   （产出 out/cat-b.png / frames.json / cat-b-preview.png）
import json
from collections import Counter
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
OUT = HERE / "out"
PET_DIR = Path(__file__).resolve().parents[3] / "packages/web/public/pet"
SRC = {"idle": PET_DIR / "idle.png", "walk": PET_DIR / "walk.png"}
BLOCK = 8  # 256 → 32
GROUND_ROW = 30

# 量化色板 = 14 色 ∪ 猫本体色组（与 A 侧 render_a.py 完全一致）
PALETTE = {
    "sky": "#1A1C2C", "bld-far": "#29366F", "bld-near": "#3B5DC9", "window": "#F7D51D",
    "street": "#333C57", "curb": "#566C86", "star": "#F4F4F4", "ok": "#92CC41",
    "bad": "#E76E55", "act": "#209CEE", "neon": "#FF004D", "paper": "#F8F5F5",
    "ink": "#212529", "panel": "#2C3136",
    "cat-body": "#E8A15D", "cat-stripe": "#B4693B", "cat-cream": "#F6E6C8",
}
RGB = {name: tuple(int(hx[i:i + 2], 16) for i in (1, 3, 5)) for name, hx in PALETTE.items()}
RGB["hi"] = RGB["window"]  # hi 与 window 同值（DESIGN.md §2：15 token 14 色）


def hx(name: str) -> tuple[int, int, int]:
    return RGB[name]


def erode1(alpha: Image.Image) -> Image.Image:
    """1px alpha 腐蚀：四邻全不透明才保留（B6 渗边缓解）。"""
    px = alpha.load()
    w, h = alpha.size
    out = Image.new("L", (w, h), 0)
    po = out.load()
    for y in range(h):
        for x in range(w):
            if min(px[max(x - 1, 0), y], px[min(x + 1, w - 1), y],
                   px[x, max(y - 1, 0)], px[x, min(y + 1, h - 1)]) > 0:
                po[x, y] = px[x, y]
    return out


def downsample(frame: Image.Image) -> list[list[tuple[int, int, int] | None]]:
    """8×8 块取众数色（不透明像素间）；块内无不透明像素 → None。"""
    w, h = frame.size
    pixels = frame.load()
    grid: list[list[tuple[int, int, int] | None]] = []
    for by in range(0, h, BLOCK):
        row_cells: list[tuple[int, int, int] | None] = []
        for bx in range(0, w, BLOCK):
            counter: Counter[tuple[int, int, int]] = Counter()
            for y in range(by, by + BLOCK):
                for x in range(bx, bx + BLOCK):
                    r, g, b, a = pixels[x, y]
                    if a >= 128:
                        counter[(r, g, b)] += 1
            row_cells.append(counter.most_common(1)[0][0] if counter else None)
        grid.append(row_cells)
    return grid


def downsample_resample(frame: Image.Image) -> list[list[tuple[int, int, int] | None]]:
    """对照法（perfectpixel-studio 同族路线）：BICUBIC 降采样（CatmullRom 同族，本机 Pillow 无该滤镜）到 32×32 后逐像素取色。
    细线条（眼/轮廓）经插值保留率高于块众数。"""
    small = frame.resize((32, 32), Image.Resampling.BICUBIC)
    pixels = small.load()
    return [[pixels[x, y][:3] if pixels[x, y][3] >= 96 else None for x in range(32)]
            for y in range(32)]


def recolor(cell: tuple[int, int, int]) -> tuple[int, int, int]:
    """灰猫 → 橘猫毛色重映射（DESIGN.md §7 毛色皮肤）：灰阶按亮度分桶，彩色按色相归类。"""
    r, g, b = cell
    lum = (r * 299 + g * 587 + b * 114) // 1000
    sat = max(cell) - min(cell)
    if sat < 28:  # 灰阶（毛色/轮廓）：白胸→奶白，浅灰→本体橙，灰斑→纹深橙，暗→墨线
        if lum > 232:
            return hx("cat-cream")
        if lum > 128:
            return hx("cat-body")
        if lum > 64:
            return hx("cat-stripe")
        return hx("ink")
    if r > 150 and g < 160 and b < 160 and r - b > 60:  # 黄系（眼）→ hi
        return hx("hi")
    if r > 140 and g < 130:  # 粉红系（耳内/鼻/腮）→ bad
        return hx("bad")
    if lum > 210:
        return hx("cat-cream")
    if lum > 120:
        return hx("cat-body")
    return hx("cat-stripe")


def baseline_align(grid: list[list[tuple[int, int, int] | None]]) -> list[list[tuple[int, int, int] | None]]:
    """底中对齐：内容最低行贴到 GROUND_ROW，水平包围盒居中（#167 §4.3 第 5 步）。"""
    h = len(grid)
    w = len(grid[0])
    rows_with_content = [y for y in range(h) if any(c is not None for c in grid[y])]
    cols_with_content = [x for x in range(w) if any(grid[y][x] is not None for y in range(h))]
    dy = GROUND_ROW - rows_with_content[-1]
    cx = (cols_with_content[0] + cols_with_content[-1]) // 2
    dx = 16 - cx
    out: list[list[tuple[int, int, int] | None]] = [[None] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w:
                out[ny][nx] = grid[y][x]
    return out


def build_cells(method: str) -> dict[str, list[list[tuple[int, int, int] | None]]]:
    cells: dict[str, list[list[tuple[int, int, int] | None]]] = {}
    for state, path in SRC.items():
        sheet = Image.open(path).convert("RGBA")
        n = sheet.size[0] // 256
        for i in range(n):
            frame = sheet.crop((i * 256, 0, (i + 1) * 256, 256))
            alpha = erode1(frame.getchannel("A"))
            frame.putalpha(alpha)
            grid = downsample_resample(frame) if method == "resample" else downsample(frame)
            grid = [[recolor(c) if c is not None else None for c in row] for row in grid]
            cells[f"{state}-{i + 1}"] = baseline_align(grid)
    return cells


def main() -> None:
    OUT.mkdir(exist_ok=True)
    order = [f"{s}-{i}" for s in ("idle", "walk") for i in (1, 2, 3)]
    for method in ("mode", "resample"):
        cells_all = build_cells(method)
        img = Image.new("RGBA", (32 * len(order), 32), (0, 0, 0, 0))
        used: Counter[str] = Counter()
        for fi, name in enumerate(order):
            grid = cells_all[name]
            for y in range(32):
                for x in range(32):
                    cell = grid[y][x]
                    if cell is not None:
                        img.putpixel((fi * 32 + x, y), cell + (255,))
                        used[f"#{cell[0]:02X}{cell[1]:02X}{cell[2]:02X}"] += 1
        # 对照结论（见票评）：resample 远优于 mode（细线条保留），resample 为 B 侧代表
        stem = "cat-b" if method == "resample" else "cat-b-mode"
        sheet_path = OUT / f"{stem}.png"
        img.save(sheet_path, optimize=True)
        size = sheet_path.stat().st_size
        out_of_palette = set(used) - set(PALETTE.values())
        print(f"[{method}] {sheet_path.name}（{size}B，预算 8KB {'✓' if size <= 8192 else '✗'}），"
              f"色板出界 {len(out_of_palette)} {'✗' if out_of_palette else '✓'}，用量 {dict(used)}")

    frames_json = {
        "contract": "manifest v2 提案（#168）— design-v3/motion.md §3 帧接口",
        "image": "cat-b.png",
        "frame": {"w": 32, "h": 32, "groundRow": GROUND_ROW},
        "palette": PALETTE,
        "animations": {
            "idle": {"from": 0, "frames": 3, "duration": 0.8, "loop": True},
            "walk": {"from": 3, "frames": 3, "duration": 0.6, "loop": True},
            "pat": {"from": -1, "frames": 0, "duration": 0.4, "loop": False,
                    "note": "原料无 pat 资产（现管线只出 9 状态单帧×3 变体），缺帧如实呈现"},
        },
        "provenance": {
            "source": "packages/web/public/pet/{idle,walk}.png（旧生图管线产物，灰白猫）",
            "post": "erode1 → 下采样(mode | bicubic 重采样，代表=resample) → 毛色重映射(灰→橘) → 17 色量化 → 底中基线对齐",
            "modelSide": "未跑（无 ARK_API_KEY）：锚点帧 img2img / 组图纪律未验证，见票评",
        },
    }
    (OUT / "frames.json").write_text(json.dumps(frames_json, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
