#!/usr/bin/env python3
# PROTOTYPE（#168 A 侧，用后即弃）：LLM 字符网格 → 确定性渲染 spritesheet + frames.json。
# 实施若走 A 侧，渲染器将以 TS 移植进 agent（ReAct 的一个 tool），本脚本只证视觉与校验规则。
# 用法：python3 render_a.py   （读取同目录 cat-grids.txt，产出 out/cat-a.png / frames.json / cat-a-preview.png）
import json
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
OUT = HERE / "out"
W = H = 32
GROUND_ROW = 30  # 硬约束：脚底接触行（design-v3/motion.md §3、#166 实施草图），r31 必须为空

# 14 色板 ∪ 猫本体色组（本体 3 色为原型提案，最终由实施票拍板；k/y/p/w 属 14 色内的 ink/hi/bad/star）
PALETTE = {
    "o": "#E8A15D",  # cat-body
    "s": "#B4693B",  # cat-stripe
    "c": "#F6E6C8",  # cat-cream
    "k": "#212529",  # ink
    "y": "#F7D51D",  # hi（眼黄）
    "p": "#E76E55",  # bad（耳内/鼻/腮）
    "w": "#F4F4F4",  # star（眼高光）
}
FRAME_ORDER = ["idle-1", "idle-2", "idle-3", "idle-4",
               "walk-1", "walk-2", "walk-3", "walk-4",
               "pat-1", "pat-2"]
ANIMS = {
    "idle": {"from": 0, "frames": 4, "duration": 0.8, "loop": True},
    "walk": {"from": 4, "frames": 4, "duration": 0.6, "loop": True},
    "pat": {"from": 8, "frames": 2, "duration": 0.4, "loop": False},
}


def parse(path: Path) -> dict[str, list[str]]:
    frames, name, rows = {}, None, []
    for raw in path.read_text().splitlines():
        line = raw.rstrip()
        if not line or line.startswith("//"):
            continue
        if line.startswith("#"):
            if name:
                frames[name] = rows
            name, rows = line[1:].strip(), []
            continue
        rows.append(line)
    if name:
        frames[name] = rows
    return frames


def validate(frames: dict[str, list[str]]) -> list[str]:
    errors = []
    for name, rows in frames.items():
        if len(rows) != H:
            errors.append(f"{name}: {len(rows)} 行 ≠ {H}")
            continue
        for i, row in enumerate(rows):
            if len(row) != W:
                errors.append(f"{name} r{i:02d}: {len(row)} 列 ≠ {W}")
            bad = set(row) - set(PALETTE) - {"."}
            if bad:
                errors.append(f"{name} r{i:02d}: 非法字符 {sorted(bad)}")
        if rows[H - 1] != "." * W:
            errors.append(f"{name}: r31 非空（脚底必须落在 r{GROUND_ROW}）")
    missing = set(FRAME_ORDER) - set(frames)
    if missing:
        errors.append(f"缺帧: {sorted(missing)}")
    return errors


def hex2rgba(hx: str) -> tuple[int, int, int, int]:
    return tuple(int(hx[i:i + 2], 16) for i in (1, 3, 5)) + (255,)  # type: ignore[return-value]


def render(frames: dict[str, list[str]]) -> Image.Image:
    img = Image.new("RGBA", (W * len(FRAME_ORDER), H), (0, 0, 0, 0))
    for i, name in enumerate(FRAME_ORDER):
        rows = frames[name]
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                if ch != ".":
                    img.putpixel((i * W + x, y), hex2rgba(PALETTE[ch]))
    return img


def diff_report(frames: dict[str, list[str]], base: str = "idle-1") -> None:
    b = frames[base]
    print(f"— 帧间差异（vs {base}，一致性参考）")
    for name in FRAME_ORDER:
        if name == base:
            continue
        rows = frames[name]
        changed = [(x, y) for y in range(H) for x in range(W) if rows[y][x] != b[y][x]]
        if not changed:
            print(f"  {name}: 与 base 完全相同")
            continue
        xs = [p[0] for p in changed]
        ys = [p[1] for p in changed]
        print(f"  {name}: {len(changed):4d} px 不同, 外框 x{min(xs)}–{max(xs)} y{min(ys)}–{max(ys)}")
    groups = {"walk": "walk-1", "pat": "pat-1"}
    for anim, first in groups.items():
        names = [n for n in FRAME_ORDER if n.startswith(anim)]
        f0 = frames[first]
        print(f"— {anim} 组内差异（vs {first}）")
        for name in names:
            if name == first:
                continue
            rows = frames[name]
            changed = sum(1 for y in range(H) for x in range(W) if rows[y][x] != f0[y][x])
            print(f"  {name}: {changed:4d} px 不同")


def main() -> None:
    frames = parse(HERE / "cat-grids.txt")
    errors = validate(frames)
    if errors:
        print(f"校验失败 {len(errors)} 处（确定性渲染器拒收，F2 免疫）：")
        for e in errors:
            print(f"  {e}")
        sys.exit(1)

    OUT.mkdir(exist_ok=True)
    img = render(frames)
    sheet = OUT / "cat-a.png"
    img.save(sheet, optimize=True)
    img.resize((W * len(FRAME_ORDER) * 8, H * 8), Image.NEAREST).save(OUT / "cat-a-preview.png")

    frames_json = {
        "contract": "manifest v2 提案（#168）— design-v3/motion.md §3 帧接口",
        "image": "cat-a.png",
        "frame": {"w": W, "h": H, "groundRow": GROUND_ROW},
        "palette": PALETTE,
        "animations": ANIMS,
    }
    (OUT / "frames.json").write_text(json.dumps(frames_json, ensure_ascii=False, indent=2) + "\n")

    size = sheet.stat().st_size
    print(f"OK: {sheet}（{size}B，预算 8KB {'✓' if size <= 8192 else '✗ 超预算'}），"
          f"{OUT / 'frames.json'}，preview ×8 已生成")
    diff_report(frames)


if __name__ == "__main__":
    main()
