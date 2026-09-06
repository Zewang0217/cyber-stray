#!/usr/bin/env python3
# PROTOTYPE（#168 B 侧补充）：pat 缺帧的程序派生——B 的原料（旧管线 9 状态）里没有 pat 状态，
# 本脚本从 cat-b.png 的 idle-1 base 派生 2 帧"下压"pat（头部/躯干下移 d px，脚底钉住），
# 这正是「B 生图出 base + A 式程序派生出动画帧」混合管线的小型实证。
# 产出 out/cat-b-hybrid.png（8 帧：idle 0-2 / walk 3-5 / pat 6-7 派生）+ frames-hybrid.json。
import json
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
OUT = HERE / "out"
SHIFT_ROWS = (4, 20)  # 头+躯干参与下压；r21-30（下半身/脚）钉住


def pat_frame(base: Image.Image, d: int) -> Image.Image:
    out = Image.new("RGBA", base.size, (0, 0, 0, 0))
    po, px = out.load(), base.load()
    w, h = base.size
    top, bottom = SHIFT_ROWS
    for y in range(h):
        for x in range(w):
            if y < top + d:                      # 顶部被压掉 d 行
                continue
            if y <= bottom + d:                  # 头/躯干整体下移 d
                po[x, y] = px[x, y - d]
            else:                                 # 下半身钉住
                po[x, y] = px[x, y]
    return out


def main() -> None:
    sheet = Image.open(OUT / "cat-b.png")
    frames = [sheet.crop((i * 32, 0, (i + 1) * 32, 32)) for i in range(6)]
    pat1 = pat_frame(frames[0], 1)
    pat2 = pat_frame(frames[0], 3)
    hybrid = Image.new("RGBA", (32 * 8, 32), (0, 0, 0, 0))
    for i, fr in enumerate([*frames, pat1, pat2]):
        hybrid.paste(fr, (i * 32, 0))
    path = OUT / "cat-b-hybrid.png"
    hybrid.save(path, optimize=True)
    frames_json = {
        "contract": "manifest v2 提案（#168）— design-v3/motion.md §3 帧接口",
        "image": "cat-b-hybrid.png",
        "frame": {"w": 32, "h": 32, "groundRow": 30},
        "animations": {
            "idle": {"from": 0, "frames": 3, "duration": 0.8, "loop": True},
            "walk": {"from": 3, "frames": 3, "duration": 0.6, "loop": True},
            "pat": {"from": 6, "frames": 2, "duration": 0.4, "loop": False,
                    "note": "pat 2 帧 = idle-1 base 程序下压派生（d=1/d=2），非生图直出——混合管线实证"},
        },
    }
    (OUT / "frames-hybrid.json").write_text(json.dumps(frames_json, ensure_ascii=False, indent=2) + "\n")
    print(f"OK: {path}（{path.stat().st_size}B），8 帧")


if __name__ == "__main__":
    main()
