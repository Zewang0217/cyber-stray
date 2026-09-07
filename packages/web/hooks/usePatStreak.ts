"use client";

import { useCallback, useRef } from "react";

/** 连拍判定窗口（ms）：窗口内累计拍数决定差异化反馈。 */
const PAT_COMBO_WINDOW_MS = 1600;
/** 2-3 连拍 = joy（呼噜）；≥GRUMPY_STREAK = 翻脸。 */
export const JOY_STREAK = 2;
export const GRUMPY_STREAK = 4;
/** 翻脸持续时长（反馈类演出秒级，之后自然回 idle）。 */
export const GRUMPY_MS = 30_000;

export type PatReaction = "pat" | "joy" | "grumpy";

/**
 * 拍拍连拍状态机（纯前端演出，#170）：1 拍 pat、2-3 连拍 joy、≥4 翻脸 grumpy。
 * 连拍窗口过期自动归 1；grumpy 归零由调用方在演出收尾时 reset。
 */
export function usePatStreak(): { onPat: () => PatReaction; reset: () => void } {
  const streakRef = useRef(0);
  const lastAtRef = useRef(0);

  const onPat = useCallback((): PatReaction => {
    const now = Date.now();
    streakRef.current =
      now - lastAtRef.current <= PAT_COMBO_WINDOW_MS ? streakRef.current + 1 : 1;
    lastAtRef.current = now;
    if (streakRef.current >= GRUMPY_STREAK) return "grumpy";
    if (streakRef.current >= JOY_STREAK) return "joy";
    return "pat";
  }, []);

  const reset = useCallback((): void => {
    streakRef.current = 0;
  }, []);

  return { onPat, reset };
}
