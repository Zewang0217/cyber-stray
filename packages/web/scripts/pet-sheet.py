#!/usr/bin/env python3
"""宠物精灵图切分管线(whale-girl 式:AI 生图 → 规范帧条)

用法:
  # 每状态一张单行 3 帧横排图(参考图锁定角色后逐状态生成)
  python3 scripts/pet-sheet.py idle.png walk.png joy.png --out public/pet

  # 单张 3x3 网格(行=状态: idle,walk,joy; 列=帧)
  python3 scripts/pet-sheet.py sheet-raw.png --grid --out public/pet

- 绿底色度抠图(G 主导且高亮 → alpha 0)
- 行带检测(y 投影)→ 行内列簇检测(x 投影,连通域)
- 逐帧裁切 → 内容占比 82% 归一化 → 底中对齐 → 256x256 帧
- 每状态横排输出 <state>.png
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

FRAME = 256
CONTENT = 0.82
GRID_STATES = ["idle", "walk", "joy"]


def chroma_key_green(arr: np.ndarray) -> np.ndarray:
    """绿幕抠图:G 明显高于 R/B 且足够亮 → 前景取反。"""
    r, g, b = arr[..., 0].astype(int), arr[..., 1].astype(int), arr[..., 2].astype(int)
    green_bg = (g > 100) & (g - r > 40) & (g - b > 40)
    return ~green_bg


def bands(proj: np.ndarray, min_len: int) -> list[tuple[int, int]]:
    """1D 投影切连续带。"""
    on = proj > 0
    out: list[tuple[int, int]] = []
    start = None
    for i, v in enumerate(on):
        if v and start is None:
            start = i
        elif not v and start is not None:
            if i - start >= min_len:
                out.append((start, i))
            start = None
    if start is not None and len(on) - start >= min_len:
        out.append((start, len(on)))
    return out


def normalize(rgba: np.ndarray) -> Image.Image:
    """内容占比归一 + 底中对齐到 FRAME 方格。"""
    alpha = rgba[..., 3] > 0
    ys, xs = np.where(alpha)
    if len(ys) == 0:
        return Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    crop = rgba[y0:y1, x0:x1]
    h, w = crop.shape[:2]
    scale = min(FRAME / w, (FRAME * CONTENT) / h)
    img = Image.fromarray(crop, "RGBA").resize(
        (max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS
    )
    canvas = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
    canvas.paste(img, ((FRAME - img.width) // 2, FRAME - img.height), img)
    return canvas


def split_frames(arr: np.ndarray, fg: np.ndarray) -> list[np.ndarray]:
    """行内按列簇切帧;不足 3 簇时均分兜底。返回 RGBA(alpha=前景)。"""
    cols = bands(fg.sum(axis=0), min_len=arr.shape[1] // 12)
    if len(cols) < 2:
        step = arr.shape[1] // 3
        cols = [(i * step, (i + 1) * step) for i in range(3)]
    out = []
    for cx0, cx1 in cols[:3]:
        rgb = arr[:, cx0:cx1]
        a = (fg[:, cx0:cx1].astype(np.uint8)) * 255
        out.append(np.dstack([rgb, a]))
    return out


def emit(frames: list[np.ndarray], out_dir: Path, name: str) -> int:
    strips = [normalize(f) for f in frames]
    strip = Image.new("RGBA", (FRAME * len(strips), FRAME), (0, 0, 0, 0))
    for i, s in enumerate(strips):
        strip.paste(s, (i * FRAME, 0))
    strip.save(out_dir / f"{name}.png")
    return len(strips)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+")
    ap.add_argument("--out", default="public/pet")
    ap.add_argument("--grid", action="store_true", help="单张 3x3 网格(行=状态)")
    ap.add_argument("--states", nargs="+", default=None, help="网格行对应的状态名(默认 idle,walk,joy)")
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    meta: dict[str, dict[str, int]] = {}

    if args.grid:
        assert len(args.inputs) == 1
        states = args.states or GRID_STATES
        assert len(states) == 3, "网格模式需恰好 3 个状态名(3 行)"
        img = Image.open(args.inputs[0]).convert("RGB")
        arr = np.array(img)
        fg = chroma_key_green(arr)
        rows = bands(fg.sum(axis=1), min_len=img.height // 8)
        assert len(rows) == 3, f"期望 3 状态行,检测到 {len(rows)}"
        for state, (ry0, ry1) in zip(states, rows, strict=True):
            row = arr[ry0:ry1]
            row_fg = fg[ry0:ry1]
            n = emit(split_frames(row, row_fg), out_dir, state)
            meta[state] = {"frames": n, "frame": FRAME}
            print(f"{state}: {n} frames")
    else:
        for path in args.inputs:
            img = Image.open(path).convert("RGB")
            arr = np.array(img)
            fg = chroma_key_green(arr)
            name = Path(path).stem
            n = emit(split_frames(arr, fg), out_dir, name)
            meta[name] = {"frames": n, "frame": FRAME}
            print(f"{name}: {n} frames")

    (out_dir / "meta.json").write_text(json.dumps(meta))
    print("done →", out_dir)


if __name__ == "__main__":
    main()
