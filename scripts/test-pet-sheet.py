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

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts/pet-sheet.py"


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


def synth_sheet_grid(n: int, empty_idx: int | None = None) -> Path:
    """n×n sheet 网格:每格一个居中色块(绿底);empty_idx 格留纯绿(模拟空格)。
    色块颜色随格序号变化,用于校验 sprite.png 的帧排布次序。"""
    cell = 512
    img = Image.new("RGB", (cell * n, cell * n), (0, 255, 0))
    px = img.load()
    # 固定非绿色板(避免合成色误中 chroma_key_green 的绿幕判定)
    colors = [(255, 0, 0), (0, 0, 255), (255, 255, 0), (255, 0, 255), (0, 128, 255),
              (255, 128, 0), (128, 0, 255), (255, 64, 64), (64, 64, 255), (192, 64, 192)]
    for i in range(n * n):
        if i == empty_idx:
            continue
        r, c = divmod(i, n)
        col = colors[i % len(colors)]
        for y in range(128, 400):
            for x in range(128, 400):
                px[c * cell + x, r * cell + y] = col
    p = Path(tempfile.mkdtemp()) / f"sheet-{n}x{n}.png"
    img.save(p)
    return p


def run_sheet(args: list[str], out: Path) -> dict:
    """sheet 模式 runner:返回 --report 输出的 {"sheet": ...} JSON。"""
    r = subprocess.run([sys.executable, str(SCRIPT), *args, "--out", str(out), "--report"],
                       capture_output=True, text=True)
    assert r.returncode == 0, f"exit {r.returncode}: {r.stderr}"
    lines = [l for l in r.stdout.strip().splitlines() if l.startswith("{")]
    assert lines, f"report 缺 JSON 行: {r.stdout}"
    return json.loads(lines[-1])


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

    # 5. sheet 4×4 全动作全帧:16 格全填满
    out = Path(tempfile.mkdtemp())
    anims = "idle:4,walk:4,sleep:2,grumpy:2,joy:2,welcome:2"
    grid = synth_sheet_grid(4)
    report = run_sheet([str(grid), "--sheet", "4", "--anims", anims, "--frame", "64"], out)
    assert report["sheet"]["emptyCells"] == 0, f"期望 0 空格: {report}"
    for name, frames in (("idle", 4), ("walk", 4), ("sleep", 2), ("grumpy", 2), ("joy", 2), ("welcome", 2)):
        im = Image.open(out / f"{name}.png")
        assert im.size == (64 * frames, 64), f"{name} 尺寸 {im.size}"
        alpha = np.array(im)[..., 3]
        assert (alpha > 0).mean() > 0.02, f"{name} 内容缺失"
    sprite = Image.open(out / "sprite.png")
    assert sprite.size == (64 * 16, 64), f"sprite.png 尺寸 {sprite.size}"
    # 帧排布:总条首帧 = 网格(0,0) 格的色块,第 5 帧 = 网格(0,4)→(1,0) 即 walk 首帧
    assert np.array(sprite)[32, 32][3] > 0, "总条首帧应为 idle-f1"
    sheet_meta = json.loads((out / "sheet-meta.json").read_text())
    assert sheet_meta["grid"] == "4x4" and sheet_meta["frame"] == 64
    assert len(sheet_meta["anims"]["idle"]["ratios"]) == 4
    print("PASS sheet 4×4(16 帧全填满 + sprite.png 总条)")

    # 6. sheet 空格记录:第 5 格(行优先 walk-f1)留纯绿 → emptyCells=1 且该帧全透明
    out = Path(tempfile.mkdtemp())
    grid = synth_sheet_grid(4, empty_idx=4)
    report = run_sheet([str(grid), "--sheet", "4", "--anims", anims, "--frame", "64"], out)
    assert report["sheet"]["emptyCells"] == 1, f"期望 1 空格: {report}"
    walk = np.array(Image.open(out / "walk.png"))
    assert (walk[:, :64, 3] > 0).sum() == 0, "walk-f1(空格)应为全透明"
    assert (walk[:, 64:, 3] > 0).mean() > 0.02, "walk-f2~f4 应有内容"
    print("PASS sheet 空格记录(空格不判死,交处理器按 meta 重试)")

    # 7. sheet 入参校验:帧数总和 != n×n 应退出非零
    r = subprocess.run(
        [sys.executable, str(SCRIPT), str(grid), "--sheet", "4",
         "--anims", "idle:4,walk:4", "--frame", "64", "--out", str(Path(tempfile.mkdtemp()))],
        capture_output=True, text=True)
    assert r.returncode != 0, "帧数总和不匹配应退出非零"
    print("PASS sheet 入参校验(帧数总和不符即报错)")

    # 8. strip 降级:1x4 行条(单动画重生成,rows=1 cols=4)
    strip_img = Path(tempfile.mkdtemp()) / "strip-1x4.png"
    im = Image.new("RGB", (512 * 4, 512), (0, 255, 0))
    px = im.load()
    for i in range(4):
        for y in range(128, 400):
            for x in range(128 + i * 512, 400 + i * 512):
                px[x, y] = (255, 0, 0)
    im.save(strip_img)
    out = Path(tempfile.mkdtemp())
    report = run_sheet([str(strip_img), "--sheet", "1x4", "--anims", "idle:4", "--frame", "64"], out)
    assert report["sheet"]["emptyCells"] == 0
    assert Image.open(out / "idle.png").size == (64 * 4, 64)
    assert Image.open(out / "sprite.png").size == (64 * 4, 64)
    print("PASS sheet 1x4(strip 降级行条)")

    print("\nALL TESTS PASSED")


if __name__ == "__main__":
    main()
