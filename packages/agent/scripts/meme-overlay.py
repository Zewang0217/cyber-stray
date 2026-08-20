#!/usr/bin/env python3
"""表情包梗文字叠加（#96）—— 图文分离硬契约的服务器端实现

生图模型只画画面（ADR-0001 + 调研结论：AI 画整句中文不可靠），梗文字由
这里用 PIL 程序叠加，100% 正确、可读、可重排版。

用法:
  python3 meme-overlay.py <image> --text "梗文案" --out <out.png>
    [--font <path>] [--max-chars-per-line N] [--bottom-margin-ratio 0.05]

规则:
- 自动缩字号（画布宽 / 最长行 * 0.75，clamp 24-96px）
- 长文案自动换行（每行 ≤ max-chars-per-line 字）
- 白字黑描边（经典梗图对比度，文字清晰可读）
- 底部横排居中（bottom-margin-ratio 控制留白）
- 中文字体：--font 优先；否则搜索常见 CJK 字体路径；找不到 → 显式报错
  （禁兜底——不渲染成方块乱码）

退出码 0 = 成功；非 0 = 失败（stderr 带原因）。
"""

import argparse
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# 常见中文字体候选（按优先级；--font 或 MEME_FONT env 可覆盖）
CJK_FONTS = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/wenquanyi/wqy-zenhei/wqy-zenhei.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
]


def find_font(explicit: str | None) -> str:
    # 显式（--font）> env（MEME_FONT）> 系统候选 + 用户 home 字体
    candidates = []
    if explicit:
        candidates.append(explicit)
    if os.environ.get("MEME_FONT"):
        candidates.append(os.environ["MEME_FONT"])
    for home in (str(Path.home()),):
        candidates.append(str(Path(home) / ".local/share/fonts/NotoSansSC-Bold.otf"))
        candidates.append(str(Path(home) / ".local/share/fonts/NotoSansSC-Regular.otf"))
    candidates += CJK_FONTS
    for path in candidates:
        if Path(path).is_file():
            return path
    raise SystemExit("未找到中文字体（用 --font 指定 MEME_FONT env，或安装 Noto Sans CJK）")


def load_font(font_path: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(font_path, size)
    except Exception as exc:  # noqa: BLE001 - 字体加载失败给明确原因
        raise SystemExit(f"字体加载失败: {font_path}: {exc}")


def wrap_text(text: str, max_chars: int) -> list[str]:
    chars = list(text)
    return ["".join(chars[i : i + max_chars]) for i in range(0, len(chars), max_chars)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--text", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--font", default=None)
    ap.add_argument("--max-chars-per-line", type=int, default=12)
    ap.add_argument("--bottom-margin-ratio", type=float, default=0.05)
    args = ap.parse_args()

    img = Image.open(args.image).convert("RGBA")
    width, height = img.size
    font_path = find_font(args.font)

    chars = list(args.text)
    longest = min(len(chars), max(1, args.max_chars_per_line))
    font_size = max(24, min(96, round((width / longest) * 0.75)))
    font = load_font(font_path, font_size)
    stroke_width = max(2, round(font_size / 10))

    lines = wrap_text(args.text, args.max_chars_per_line)

    # 用 Draw.textbbox 测量每行实际像素宽，选最宽行定整体宽度
    draw = ImageDraw.Draw(img)
    max_line_w = 0
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font, stroke_width=stroke_width)
        max_line_w = max(max_line_w, bbox[2] - bbox[0])
    line_h = font_size + stroke_width * 2 + 8

    # 底部留白区域（bottom-margin-ratio 相对画布高）
    margin_bottom = round(height * args.bottom_margin_ratio)
    total_h = line_h * len(lines)
    block_top = height - margin_bottom - total_h

    for i, line in enumerate(lines):
        bbox = draw.textbbox((0, 0), line, font=font, stroke_width=stroke_width)
        lw = bbox[2] - bbox[0]
        x = (width - lw) // 2 - bbox[0]
        y = block_top + i * line_h
        # 半透明黑底条（可读性）+ 白字黑描边
        draw.rectangle(
            [x - 12, y - 6, x + lw + 12, y + font_size + stroke_width + 6],
            fill=(0, 0, 0, 140),
        )
        draw.text(
            (x, y),
            line,
            font=font,
            fill=(255, 255, 255, 255),
            stroke_width=stroke_width,
            stroke_fill=(0, 0, 0, 255),
        )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(out, "PNG")
    print(f"overlay ok: {width}x{height}, {len(lines)} lines, font={font_size}px")


if __name__ == "__main__":
    main()
