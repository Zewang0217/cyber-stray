#!/usr/bin/env python3
"""STRAY-BOY 默认猫 sprite 构建器（spec #184 Decision 5，#169 帧表 v2）。

A 侧字符网格画布（段定义即画布，LLM 可直接产出本文件的段数据）+ 程序派生
（腿相位/尾摆/下压/腾空），确定性渲染 26 帧横排 sheet + eyes 叠加 2 帧 +
frames.json（contract stray-boy.sprite.v2）。

硬校验（渲染前全过，否则退出非零）：
  - 每行 32 列、字符白名单（17 色板编码）、r31 空、脚底接触行 r30
  - sheet ≤8KB、帧数 = 26、eyes = 2

用法：python3 scripts/sprite/build_sprite.py（产物落 public/pet/strayboy/）
"""
import json
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
OUT = HERE.parent.parent / "public" / "pet" / "strayboy"
W = H = 32
GROUND_ROW = 30
BUDGET = 8192

PALETTE = {
    "o": "#E8A15D",  # cat-body
    "s": "#B4693B",  # cat-stripe
    "c": "#F6E6C8",  # cat-cream
    "k": "#212529",  # ink
    "y": "#F7D51D",  # hi（眼黄）
    "p": "#E76E55",  # bad（耳内/鼻/腮）
    "w": "#F4F4F4",  # star（眼高光）
}
RGBA = {ch: tuple(int(hx[i:i + 2], 16) for i in (1, 3, 5)) + (255,) for ch, hx in PALETTE.items()}

# ── 画布原语 ──────────────────────────────────────────────

def row(*segs: str | int) -> str:
    out = []
    for seg in segs:
        out.append("." * seg if isinstance(seg, int) else seg)
    line = "".join(out)
    if len(line) != W:
        raise ValueError(f"段和 {len(line)} ≠ {W}: {line}")
    return line


BLANK = row(32)
SIT_BODY = ("k", "ooooo", "cccccc", "ooooo", "k")


def grid_of(frame: list[str]) -> list[list[str]]:
    return [list(r) for r in frame]


def text_of(grid: list[list[str]]) -> list[str]:
    return ["".join(r) for r in grid]


def shift_band(frame: list[str], top: int, bottom: int, dy: int = 0, dx: int = 0) -> list[str]:
    """把 [top,bottom] 行带整体平移（dy 下正 / dx 右正），带外保持，越界丢弃。"""
    g = grid_of(frame)
    src = [r[:] for r in g]
    for y in range(H):
        for x in range(W):
            sy, sx = y - dy, x - dx
            g[y][x] = src[sy][sx] if top <= sy <= bottom and 0 <= sx < W else (
                src[y][x] if not top <= y <= bottom else ".")
    return text_of(g)


def move_block(frame: list[str], top: int, bottom: int, x_from: int, x_to: int, dy: int) -> list[str]:
    """把矩形块像素搬移 dy 行（源位清空）——招手举爪用。"""
    g = grid_of(frame)
    for y in range(top, bottom + 1):
        for x in range(x_from, x_to + 1):
            g[y][x] = "."
    for y in range(top, bottom + 1):
        ny = y + dy
        if 0 <= ny < H:
            for x in range(x_from, x_to + 1):
                g[ny][x] = frame[y][x]
    return text_of(g)


# ── 端坐（idle/pat/joy/eat/sleep/think/grumpy/welcome/pounce 的母体）──

ALL_O_FACE = row(5, "k", 20 * "o", "k", 5)
CLOSED_EYES = row(5, "k", "ooo", "kkk", "ooooooo", "kkk", "oooo", "k", 5)
BIG_BLUSH = row(5, "k", "ppp", "oooo", "cccccc", "oooo", "ppp", "k", 5)


def sit_common() -> dict[int, str]:
    return {
        3: row(8, "kk", 12, "kk", 8),
        4: row(7, "kppk", 10, "kppk", 7),
        5: row(6, "koooook", 6, "koooook", 6),
        6: row(5, "k", 20 * "o", "k", 5),
        7: row(5, "k", "oooo", "ss", "ooo", "ss", "ooo", "ss", "oooo", "k", 5),
        8: row(5, "k", "oooo", "ss", "ooo", "ss", "ooo", "ss", "oooo", "k", 5),
        9: row(5, "k", "ooo", "yyy", "ooooooo", "yyy", "oooo", "k", 5),
        10: row(5, "k", "ooo", "wyk", "ooooooo", "wyk", "oooo", "k", 5),
        11: row(5, "k", "ooo", "yyy", "ooooooo", "yyy", "oooo", "k", 5),
        12: row(5, "k", "o", "pp", "oooo", "cccccc", "oooo", "pp", "o", "k", 5),
        13: row(5, "k", "oo", "ccccccc", "pp", "ccccccc", "oo", "k", 5),
        14: row(5, "k", "ooo", "cccccc", "kk", "cccccc", "ooo", "k", 5),
        15: row(5, "k", "oo", 16 * "c", "oo", "k", 5),
        16: row(6, "k", 18 * "o", "k", 6),
        17: row(7, *SIT_BODY, 7),
        18: row(7, *SIT_BODY, 7),
        19: row(7, *SIT_BODY, 7),
        20: row(7, *SIT_BODY, 7),
        21: row(7, *SIT_BODY, 7),
        22: row(7, *SIT_BODY, 7),
        23: row(7, *SIT_BODY, 7),
        24: row(6, "k", "ooooo", "cccccccc", "ooooo", "k", 6),
        25: row(5, "k", "oooooo", "cccccccc", "oooooo", "ss", 4),
        26: row(5, "k", 20 * "o", "ss", 4),
        27: row(5, "k", "ooooo", "k", "oooooooo", "k", "ooooo", "ss", 4),
        28: row(5, "k", "ccccc", "k", "cccccccc", "k", "ccccc", "ss", 4),
        29: row(5, "k", "ccccc", "k", "cccccccc", "k", "cc", "ssssss", 3),
        30: row(5, 18 * "k", "ssssss", 3),
    }


def sit_frame(rows: dict[int, str], drop: list[int], top_blank: int,
              overrides: dict[int, str] | None = None) -> list[str]:
    """从端坐行派生：删 drop 行（躯干压缩），上补空行保 r30 落脚。"""
    overrides = overrides or {}
    out = [BLANK] * top_blank
    for r in range(3, 31):
        if r not in drop:
            out.append(overrides.get(r, rows[r]))
    out.append(BLANK)
    assert len(out) == H
    return out


def lift(frame: list[str], dy: int) -> list[str]:
    """整猫上移 dy（腾空帧），脚底离地。"""
    g = grid_of(frame)
    src = [r[:] for r in g]
    for y in range(H):
        g[y] = src[y + dy] if y + dy < H else ["."] * W
    return text_of(g)


def build_sit_frames() -> dict[str, list[str]]:
    base = sit_common()
    tail_up = dict(base)
    for r in (21, 22, 23):
        tail_up[r] = row(7, *SIT_BODY, "ss", 5)
    tail_up[24] = row(6, "k", "ooooo", "cccccccc", "ooooo", "k", "ss", 4)
    for r in (27, 28):
        body = {27: ("k", "ooooo", "k", "oooooooo", "k", "ooooo", "k"),
                28: ("k", "ccccc", "k", "cccccccc", "k", "ccccc", "k")}[r]
        tail_up[r] = row(5, *body, 5)
    tail_up[29] = row(5, "k", "ccccc", "k", "cccccccc", "k", "ccccc", "k", 5)
    tail_up[30] = row(5, 22 * "k", 5)
    tail_mid = dict(base)
    tail_mid[23] = row(7, *SIT_BODY, "ss", 5)
    tail_mid[24] = row(6, "k", "ooooo", "cccccccc", "ooooo", "k", "ss", 4)

    blink = {9: ALL_O_FACE, 10: CLOSED_EYES, 11: ALL_O_FACE}
    head_rows = range(4, 16)
    eat1 = shift_band(text_of(grid_of(sit_frame(base, [], 3))), min(head_rows), max(head_rows), dy=2)
    eat2 = shift_band(text_of(grid_of(sit_frame(base, [], 3))), min(head_rows), max(head_rows), dy=3)
    think1 = shift_band(text_of(grid_of(sit_frame(base, [], 3))), min(head_rows), max(head_rows), dx=1)
    grumpy1 = shift_band(
        text_of(grid_of(sit_frame(base, [], 3, blink))), min(head_rows), max(head_rows), dx=-1)
    welcome1 = move_block(sit_frame(base, [], 3), 26, 30, 6, 11, -4)
    return {
        "idle-1": sit_frame(base, [], 3),
        "idle-2": sit_frame(tail_up, [], 3),
        "idle-3": sit_frame(base, [], 3, blink),
        "idle-4": sit_frame(tail_mid, [], 3),
        "joy-1": sit_frame(base, [19], 4),            # 蜷
        "joy-2": sit_frame(base, [17], 4),            # 伸展
        "eat-1": eat1,                                 # 低头
        "eat-2": eat2,                                 # 低头+1（咀嚼）
        "sleep-1": sit_frame(base, [], 3, blink),      # 闭眼
        "sleep-2": shift_band(text_of(grid_of(sit_frame(base, [], 3, blink))),
                              min(head_rows), max(head_rows), dy=1),  # 点头
        "think-1": think1,                             # 歪头
        "think-2": sit_frame(base, [], 3),             # 回正
        "celebrate-1": lift(sit_frame(base, [], 3), 2),  # 跳起
        "celebrate-2": sit_frame(base, [19], 4),       # 落地蜷
        "grumpy-1": grumpy1,                           # 别过头去
        "grumpy-2": sit_frame(base, [], 3),            # 回瞪
        "welcome-1": welcome1,                         # 举爪
        "welcome-2": sit_frame(base, [], 3),           # 收爪
        "pat-1": sit_frame(base, [19], 4),             # 下压
        "pat-2": sit_frame(base, [19, 20], 5,
                           {9: ALL_O_FACE, 10: CLOSED_EYES, 11: ALL_O_FACE, 12: BIG_BLUSH}),
        "pounce-1": sit_frame(base, [18, 19], 5),      # 蓄力深蜷
        "pounce-2": lift(sit_frame(base, [], 3), 3),   # 腾空
    }


# ── 侧影 walk（朝左）：头 r04-15 + 低圆躯干 r16-25 + 短腿 r26-30 ──

WALK_FACES: dict[int, tuple] = {
    8: ("ss", "ooo", "ss", "oooooo"),
    9: ("ss", "ooo", "ss", "oooooo"),
    10: ("oo", "wyk", "oooooooo"),
    11: ("oo", "wyk", "oooooooo"),
    12: ("oo", "yyy", "oooooooo"),
    13: ("pp", "cccccc", "ooooo"),
    14: ("cccccc", "ooooooo"),
}
WALK_EARS: dict[int, tuple] = {
    4: (4, "kk", 4, "kk", 20),
    5: (3, "kppk", 2, "kppk", 19),
    6: (2, "k", 11 * "o", "k", 17),
    7: (1, "k", 13 * "o", "k", 16),
}
WALK_LEGS: dict[str, list[tuple[int, str]]] = {
    "walk-1": [(9, "o"), (13, "s"), (20, "s"), (24, "o")],
    "walk-2": [(11, "o"), (14, "s"), (19, "s"), (22, "o")],
    "walk-3": [(12, "o"), (14, "s"), (18, "s"), (21, "o")],
    "walk-4": [(11, "o"), (14, "s"), (19, "s"), (22, "o")],
}


def walk_rows(phase_p: bool) -> dict[int, str]:
    rows: dict[int, str] = {}
    for r, segs in WALK_EARS.items():
        rows[r] = row(*segs)
    for r, face in WALK_FACES.items():
        if r == 13:  # P 相位尾尖（25-26 列）
            rows[r] = row(1, "k", *face, "k", *((9, "ss", 5) if phase_p else (16,)))
        elif r == 14:  # P: 尾中段 26-27；Q: 尖左移 25-26
            rows[r] = row(1, "k", *face, "k", *((10, "ss", 4) if phase_p else (9, "ss", 5)))
        else:
            rows[r] = row(1, "k", *face, "k", 16)
    rows[15] = row(2, "k", 11 * "o", "k", 11, "ss", 4) if phase_p \
        else row(2, "k", 11 * "o", "k", 10, "ss", 5)
    rows[16] = row(9, "k", 16 * "o", "k", "ss", 3)
    rows[17] = row(8, "k", 17 * "o", "k", "ss", 3)
    rows[18] = row(8, "k", "oooo", "ss", "oooo", "ss", "ooooo", "k", "ss", 3)
    rows[19] = row(8, "k", "oooo", "ss", "oooo", "ss", "ooooo", "k", "ss", 3)
    rows[20] = row(8, "k", 17 * "o", "k", "ss", 3)
    rows[21] = row(8, "k", 17 * "o", "k", 5)
    rows[22] = row(8, "k", 17 * "o", "k", 5)
    rows[23] = row(8, "k", 17 * "o", "k", 5)
    rows[24] = row(8, "k", 17 * "o", "k", 5)
    rows[25] = row(9, "k", 16 * "o", "k", 5)
    return rows


def build_walk_frame(legs: list[tuple[int, str]], phase_p: bool) -> list[str]:
    rows = walk_rows(phase_p)
    out = [BLANK] * 4
    for r in range(4, 26):
        out.append(rows[r])
    for r in range(26, 30):
        segs: list[str | int] = []
        prev = 0
        for start, ch in legs:
            segs.append(start - prev)
            segs.append(2 * ch)
            prev = start + 2
        out.append(row(*segs, 32 - prev))
    segs, prev = [], 0
    for start, _ in legs:
        segs.append(start - prev)
        segs.append("kk")
        prev = start + 2
    out.append(row(*segs, 32 - prev))
    out.append(BLANK)
    assert len(out) == H
    return out


# ── eyes 叠加（饥饿 .eyes 独立层：f1 睁 / f2 闭，取自 base 眼带）──

def build_eyes() -> list[list[str]]:
    """饥饿眼睛叠加（帧序 f1 闭 / f2 睁）。闭眼帧必须盖住烘焙的睁眼块：
    眼区（r9-11）的黄/白像素替换为本体色 + 保留墨线；睁眼帧原样。"""
    base = sit_frame(sit_common(), [], 3)
    frames = []
    for map_open in (False, True):
        g = grid_of([BLANK] * H)
        for y in range(9, 12):
            for x in range(W):
                ch = base[y][x]
                if ch in ("y", "w", "k"):
                    if map_open:
                        g[y][x] = ch
                    elif ch in ("y", "w"):
                        g[y][x] = "o"  # 闭眼：盖住烘焙睁眼块
                    else:
                        g[y][x] = ch
        frames.append(text_of(g))
    return frames


# ── 帧表 v2（motion.md §3.5）与渲染 ─────────────────────────

ANIMS = {
    "idle": (4, 0.8, True), "walk": (4, 0.6, True), "joy": (2, 0.4, True),
    "eat": (2, 0.8, True), "sleep": (2, 1.6, True), "think": (2, 0.8, True),
    "celebrate": (2, 0.4, True), "grumpy": (2, 1.2, True), "welcome": (2, 0.8, True),
    "pat": (2, 0.4, False), "pounce": (2, 0.4, False),
}
ORDER = ([f"idle-{i}" for i in range(1, 5)] + [f"walk-{i}" for i in range(1, 5)]
         + [f"{a}-{i}" for a in ("joy", "eat", "sleep", "think", "celebrate", "grumpy",
                                 "welcome", "pat", "pounce")
            for i in range(1, 3)])


def validate(frames: dict[str, list[str]]) -> None:
    for name, rows in frames.items():
        if len(rows) != H:
            raise ValueError(f"{name}: {len(rows)} 行")
        for i, r in enumerate(rows):
            if len(r) != W:
                raise ValueError(f"{name} r{i}: {len(r)} 列")
            if set(r) - set(PALETTE) - {"."}:
                raise ValueError(f"{name} r{i}: 非法字符")
        grounded = not name.startswith(("celebrate-1", "pounce-2"))
        if rows[H - 1] != BLANK and grounded:
            raise ValueError(f"{name}: r31 非空且非腾空帧")
        if grounded and all(c == "." for c in rows[GROUND_ROW]):
            raise ValueError(f"{name}: 脚底接触行 r{GROUND_ROW} 无内容")
    if set(frames) != set(ORDER):
        raise ValueError(f"帧集合不符: {set(frames) ^ set(ORDER)}")


def render(frames: dict[str, list[str]], path: Path, order: list[str]) -> None:
    img = Image.new("RGBA", (W * len(order), H), (0, 0, 0, 0))
    for i, name in enumerate(order):  # 帧排布顺序由调用方给定（frames.json 的 from 依赖它）
        rows = frames[name]
        for y in range(H):
            for x in range(W):
                ch = rows[y][x]
                if ch != ".":
                    img.putpixel((i * W + x, y), RGBA[ch])
    img.save(path, optimize=True)


def main() -> None:
    frames = {**build_sit_frames(),
              **{n: build_walk_frame(legs, n in ("walk-1", "walk-3"))
                 for n, legs in WALK_LEGS.items()}}
    validate(frames)
    OUT.mkdir(parents=True, exist_ok=True)

    cat_path = OUT / "cat.png"
    render(frames, cat_path, ORDER)
    eyes = build_eyes()
    render({f"eyes-{i}": eyes[i] for i in range(2)}, OUT / "eyes.png",
           [f"eyes-{i}" for i in range(2)])

    anims, cursor = {}, 0
    for name, (count, dur, loop) in ANIMS.items():
        anims[name] = {"from": cursor, "frames": count, "duration": dur, "loop": loop}
        cursor += count
    contract = {
        "contract": "stray-boy.sprite.v2",
        "image": "cat.png",
        "frame": {"w": W, "h": H, "groundRow": GROUND_ROW},
        "animations": anims,
        "overlays": {"hungry": {"image": "eyes.png", "frames": 2, "duration": 1.2}},
        "palette": PALETTE,
        "provenance": {
            "pipeline": "A 侧字符网格画布 + 程序派生（#169 落锤；B 基混合管线资产就绪后整体替换）",
            "script": "packages/web/scripts/sprite/build_sprite.py（确定性，可重跑）",
        },
    }
    (OUT / "frames.json").write_text(json.dumps(contract, ensure_ascii=False, indent=2) + "\n")

    size = cat_path.stat().st_size
    if size > BUDGET:
        raise ValueError(f"sheet {size}B 超预算 {BUDGET}B")
    print(f"OK: cat.png {len(frames)} 帧 {size}B（≤{BUDGET}B）+ eyes.png 2 帧 + frames.json")


if __name__ == "__main__":
    main()
