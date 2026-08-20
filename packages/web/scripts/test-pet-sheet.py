#!/usr/bin/env python3
"""pet-sheet.py 网格切分合成测试(自包含,无网络)。

合成 3x3 与 2x2 网格(纯色块+绿底/白线),验证:
- strip 模式(3 状态帧条)仍兼容
- cells 模式 3x3 → 9 状态各 1 帧
- cells 模式 2x2 → 3 状态 + 空格跳过
- 绿底 + 白线分隔两种背景都切得对
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent.parent.parent
SCRIPT = ROOT / "packages/web/scripts/pet-sheet.py"


def synth_strip_grid() -> Path:
    """3x3 strip 网格:3 行状态 × 3 列帧,绿底。每帧一个不同位置的色块。"""
    cell = 100
    img = Image.new("RGB", (cell * 3, cell * 3), (0, 255, 0))
    px = img.load()
    colors = [(255, 0, 0), (0, 0, 255), (255, 255, 0)]
    for row in range(3):
        for col in range(3):
            c = colors[row]
            for y in range(30, 70):
                for x in range(30 + col * 15, 60 + col * 15):
                    px[col * cell + x, row * cell + y] = c
    p = Path(tempfile.mkdtemp()) / "strip-grid.png"
    img.save(p)
    return p


def synth_cells_grid(ncols: int, nstates: int) -> Path:
    """cells 网格:每格 1 个色块,绿底+白线分隔;空格无前景。"""
    cell = 120
    nrows = -(-nstates // ncols)  # ceil
    img = Image.new("RGB", (cell * ncols, cell * nrows), (0, 255, 0))
    px = img.load()
    colors = [(255, 0, 0), (0, 0, 255), (255, 255, 0), (0, 255, 255), (255, 0, 255), (0, 128, 255),
              (255, 128, 0), (128, 0, 255), (255, 64, 64)]
    for i in range(nstates):
        r, c = i // ncols, i % ncols
        col = colors[i % len(colors)]
        for y in range(30, 90):
            for x in range(30, 90):
                px[c * cell + x, r * cell + y] = col
    # 白色格线(2px)
    d = np.array(img)
    for i in range(1, ncols):
        d[:, i * cell - 1:i * cell + 1] = 255
    for i in range(1, nrows):
        d[i * cell - 1:i * cell + 1, :] = 255
    p = Path(tempfile.mkdtemp()) / "cells-grid.png"
    Image.fromarray(d).save(str(p))
    return p


def run(args: list[str], out: Path) -> dict:
    r = subprocess.run([sys.executable, str(SCRIPT), *args, "--out", str(out)],
                       capture_output=True, text=True)
    assert r.returncode == 0, f"exit {r.returncode}: {r.stderr}"
    return json.loads((out / "meta.json").read_text())


def main() -> None:
    # 1. strip 模式兼容
    out = Path(tempfile.mkdtemp())
    meta = run([str(synth_strip_grid()), "--grid", "--states", "idle", "walk", "joy", "--out", str(out)],
               out)
    for s in ("idle", "walk", "joy"):
        assert meta[s]["frames"] == 3, f"strip {s} 期望 3 帧,实际 {meta[s]}"
        im = Image.open(out / f"{s}.png")
        assert im.size == (256 * 3, 256), f"strip {s} 尺寸 {im.size}"
    print("PASS strip 模式(3 状态 × 3 帧)")

    # 2. cells 3x3 → 9 状态
    out = Path(tempfile.mkdtemp())
    states = ["idle", "walk", "joy", "eat", "sleep", "think", "celebrate", "grumpy", "welcome"]
    meta = run([str(synth_cells_grid(3, 9)), "--grid", "--cells", "--states", *states, "--out", str(out)],
               out)
    assert len(meta) == 9, f"期望 9 状态,实际 {len(meta)}"
    for s in states:
        assert meta[s]["frames"] == 1, f"{s} 期望 1 帧,实际 {meta[s]}"
        im = Image.open(out / f"{s}.png")
        assert im.size == (256, 256)
        alpha = np.array(im)[..., 3]
        assert (alpha > 0).mean() > 0.05, f"{s} 内容缺失"
    print("PASS cells 3x3(9 状态 × 1 帧)")

    # 3. cells 2x2 → 3 状态 + 空格跳过
    out = Path(tempfile.mkdtemp())
    meta = run([str(synth_cells_grid(2, 3)), "--grid", "--cells", "--cols", "2",
                "--states", "idle", "walk", "joy", "--out", str(out)], out)
    assert len(meta) == 3, f"期望 3 状态,实际 {len(meta)}"
    for s in ("idle", "walk", "joy"):
        assert meta[s]["frames"] == 1
        alpha = np.array(Image.open(out / f"{s}.png"))[..., 3]
        assert (alpha > 0).mean() > 0.05
    print("PASS cells 2x2(3 状态 + 空格跳过)")

    # 4. 绿底无白线 cells 2x2 也应正确(纯绿背景)
    cell = 120
    img = Image.new("RGB", (cell * 2, cell * 2), (0, 255, 0))
    px = img.load()
    for i, col in enumerate([(255, 0, 0), (0, 0, 255), (255, 255, 0)]):
        r, c = i // 2, i % 2
        for y in range(30, 90):
            for x in range(30, 90):
                px[c * cell + x, r * cell + y] = col
    p = Path(tempfile.mkdtemp()) / "green-2x2.png"
    img.save(p)
    out = Path(tempfile.mkdtemp())
    meta = run([str(p), "--grid", "--cells", "--cols", "2", "--states", "idle", "walk", "joy", "--out", str(out)], out)
    assert len(meta) == 3, f"纯绿 2x2 期望 3 状态,实际 {len(meta)}"
    print("PASS cells 2x2(纯绿背景,无白线)")

    print("\nALL TESTS PASSED")


if __name__ == "__main__":
    main()
