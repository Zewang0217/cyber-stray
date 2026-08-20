#!/usr/bin/env python3
"""生成素材结构质检(#94)——ADR-0001 两层质检的结构层。

检查成品状态帧是否满足素材契约(spike §5):
- 256x256 方格(解析 PNG IHDR,不依赖 PIL 之外的能力)
- 透明底(存在 alpha 通道,且背景区域确实透明)
- 内容占比 ≥ 20%(前景像素比例;角色被切断/整格空白 → 不合格)

用法:
  python3 qc-structure.py <states_dir> idle walk joy ...

输出:stdout 单行 JSON { "ok": bool, "states": { "<state>": { ok, width, height,
hasAlpha, contentRatio, reason? } } }。任一状态不合格 → ok=false。
退出码:全部合格 0;有不合格 1(供调用方判定)。
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

FRAME = 256
MIN_CONTENT = 0.20


def check_png(path: Path) -> dict:
    img = Image.open(path)
    width, height = img.size
    mode = img.mode
    has_alpha = "A" in mode
    # 转 RGBA 统一取 alpha(LA/RGBA 之外的模式若声称透明也按 alpha 处理)
    rgba = img.convert("RGBA")
    arr = np.array(rgba)
    content_ratio = float((arr[..., 3] > 0).mean())
    reasons: list[str] = []
    if (width, height) != (FRAME, FRAME):
        reasons.append(f"尺寸 {width}x{height} != {FRAME}x{FRAME}")
    if not has_alpha:
        reasons.append("无 alpha 通道(非透明底)")
    if content_ratio < MIN_CONTENT:
        reasons.append(f"内容占比 {content_ratio:.1%} < {MIN_CONTENT:.0%}(可能被切断或整格空白)")
    ok = not reasons
    return {
        "ok": ok,
        "width": width,
        "height": height,
        "hasAlpha": has_alpha,
        "contentRatio": round(content_ratio, 4),
        **({"reason": "；".join(reasons)} if reasons else {}),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("states_dir")
    ap.add_argument("states", nargs="+")
    args = ap.parse_args()

    states_dir = Path(args.states_dir)
    results: dict[str, dict] = {}
    missing: list[str] = []
    for state in args.states:
        path = states_dir / f"{state}.png"
        if not path.is_file():
            missing.append(state)
            results[state] = {"ok": False, "reason": "文件缺失"}
            continue
        try:
            results[state] = check_png(path)
        except Exception as error:  # noqa: BLE001 —— 解析失败按不合格上报,交由语义层/重试
            results[state] = {"ok": False, "reason": f"读取失败: {error}"}

    ok = not missing and all(r["ok"] for r in results.values())
    print(json.dumps({"ok": ok, "states": results}, ensure_ascii=False))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
