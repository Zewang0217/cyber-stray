#!/usr/bin/env python3
# PROTOTYPE（#168 A 侧）：按段计数拼装 cat-grids.txt——LLM 的画布输出即本文件的段定义；
# 每行段和 ≠ 32 直接报错，避免手拼整行时的空格/列数笔误。渲染仍由 render_a.py 消费网格文件。
from pathlib import Path

HERE = Path(__file__).parent
W = H = 32


def row(*segs: str | int) -> str:
    out = []
    for s in segs:
        out.append("." * s if isinstance(s, int) else s)
    line = "".join(out)
    if len(line) != W:
        raise ValueError(f"段和 {len(line)} ≠ {W}: {line}")
    return line


BLANK = row(32)
SIT_BODY = ("k", "ooooo", "cccccc", "ooooo", "k")  # 端坐躯干：7 空位包边内 16


def sit_common() -> dict[int, str]:
    """端坐公共行（r03-r30）。尾 = 右后贴身 s 条（r25-28）+ 地面回扫（r29-30）。"""
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
              eye_overrides: dict[int, str] | None = None) -> list[str]:
    """从端坐行派生一帧：删除 drop 中的躯干行（压缩），上补 top_blank 空行，保证 r30 落脚。"""
    eye_overrides = eye_overrides or {}
    out = [BLANK] * top_blank
    for r in range(3, 31):
        if r in drop:
            continue
        out.append(eye_overrides.get(r, rows[r]))
    out.append(BLANK)
    assert len(out) == H, f"帧行数 {len(out)} ≠ {H}"
    return out


ALL_O_FACE = row(5, "k", 20 * "o", "k", 5)
CLOSED_EYES = row(5, "k", "ooo", "kkk", "ooooooo", "kkk", "oooo", "k", 5)
BIG_BLUSH = row(5, "k", "ppp", "oooo", "cccccc", "oooo", "ppp", "k", 5)


def build_sit_frames() -> dict[str, list[str]]:
    base = sit_common()
    tail_up = dict(base)  # 尾上挑：r21-24 右缘接管为尾，地面回扫收回
    for r in (21, 22, 23):
        tail_up[r] = row(7, *SIT_BODY, "ss", 5)
    tail_up[24] = row(6, "k", "ooooo", "cccccccc", "ooooo", "k", "ss", 4)
    for r in (27, 28):
        body = {27: ("k", "ooooo", "k", "oooooooo", "k", "ooooo", "k"),
                28: ("k", "ccccc", "k", "cccccccc", "k", "ccccc", "k")}[r]
        tail_up[r] = row(5, *body, 5)
    tail_up[29] = row(5, "k", "ccccc", "k", "cccccccc", "k", "ccccc", "k", 5)
    tail_up[30] = row(5, 22 * "k", 5)
    tail_mid = dict(base)  # 尾半举：只抬 r23-24，与地面尾连续
    tail_mid[23] = row(7, *SIT_BODY, "ss", 5)
    tail_mid[24] = row(6, "k", "ooooo", "cccccccc", "ooooo", "k", "ss", 4)
    return {
        "idle-1": sit_frame(base, drop=[], top_blank=3),
        "idle-2": sit_frame(tail_up, drop=[], top_blank=3),
        "idle-3": sit_frame(base, drop=[], top_blank=3,
                            eye_overrides={9: ALL_O_FACE, 10: CLOSED_EYES, 11: ALL_O_FACE}),
        "idle-4": sit_frame(tail_mid, drop=[], top_blank=3),
        "pat-1": sit_frame(base, drop=[19], top_blank=4),
        "pat-2": sit_frame(base, drop=[19, 20], top_blank=5,
                           eye_overrides={9: ALL_O_FACE, 10: CLOSED_EYES, 11: ALL_O_FACE,
                                          12: BIG_BLUSH}),
    }


# ── 侧影 walk（朝左）：头 r04-15 + 低圆躯干 r16-25 + 短腿 r26-30，近腿 o / 远腿 s；
#    尾 = 上翘 S 弯（P 相位尖在 r13，Q 相位尖在 r14 左移一格）──
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
    if phase_p:  # 尾条：P 尖 r13(25-26) → r14(26-27) → r15-20(27-28)
        rows[15] = row(2, "k", 11 * "o", "k", 11, "ss", 4)
    else:        # Q 尖 r14(25-26) → r15(26-27) → r16-20(27-28)
        rows[15] = row(2, "k", 11 * "o", "k", 10, "ss", 5)
    rows[16] = row(9, "k", 16 * "o", "k", "ss", 3)
    rows[17] = row(8, "k", 17 * "o", "k", "ss", 3)
    rows[18] = row(8, "k", "oooo", "ss", "oooo", "ss", "ooooo", "k", "ss", 3)  # 躯干虎纹
    rows[19] = row(8, "k", "oooo", "ss", "oooo", "ss", "ooooo", "k", "ss", 3)
    rows[20] = row(8, "k", 17 * "o", "k", "ss", 3)
    rows[21] = row(8, "k", 17 * "o", "k", 5)
    rows[22] = row(8, "k", 17 * "o", "k", 5)
    rows[23] = row(8, "k", 17 * "o", "k", 5)
    rows[24] = row(8, "k", 17 * "o", "k", 5)
    rows[25] = row(9, "k", 16 * "o", "k", 5)
    return rows


WALK_LEGS: dict[str, list[tuple[int, str]]] = {
    "walk-1": [(9, "o"), (13, "s"), (20, "s"), (24, "o")],   # 前伸后蹬
    "walk-2": [(11, "o"), (14, "s"), (19, "s"), (22, "o")],  # 收拢
    "walk-3": [(12, "o"), (14, "s"), (18, "s"), (21, "o")],  # 前蹬后伸
    "walk-4": [(11, "o"), (14, "s"), (19, "s"), (22, "o")],  # 收拢
}


def build_walk_frame(legs: list[tuple[int, str]], phase_p: bool) -> list[str]:
    rows = walk_rows(phase_p)
    out = [BLANK] * 4
    for r in range(4, 26):
        out.append(rows[r])
    for r in range(26, 30):  # 腿（近 o / 远 s）
        segs: list[str | int] = []
        prev = 0
        for start, ch in legs:
            segs.append(start - prev)
            segs.append(2 * ch)
            prev = start + 2
        out.append(row(*segs, 32 - prev))
    segs, prev = [], 0  # 掌底线
    for start, _ in legs:
        segs.append(start - prev)
        segs.append("kk")
        prev = start + 2
    out.append(row(*segs, 32 - prev))
    out.append(BLANK)
    assert len(out) == H, f"帧行数 {len(out)} ≠ {H}"
    return out


def main() -> None:
    frames = {**build_sit_frames(),
              **{name: build_walk_frame(legs, name in ("walk-1", "walk-3"))
                 for name, legs in WALK_LEGS.items()}}
    lines: list[str] = [
        "// PROTOTYPE #168 A 侧画布：由 build_grids.py 按段计数生成（LLM 画布输出 = 段定义），",
        "// render_a.py 消费本文件做确定性校验与渲染。字符表：o=本体橙 s=纹深橙(远侧腿/尾) c=奶白",
        "// k=墨线 y=眼黄 p=粉(耳/鼻/腮) w=高光 .=透明。32×32，脚底接触行 r30。",
    ]
    for name, rows in frames.items():
        lines.append(f"\n# {name}")
        lines.extend(rows)
    (HERE / "cat-grids.txt").write_text("\n".join(lines) + "\n")
    print(f"OK: cat-grids.txt 生成（{len(frames)} 帧 × {H} 行，段和已校验）")


if __name__ == "__main__":
    main()
