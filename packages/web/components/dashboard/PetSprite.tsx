"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { PET_STATES, patResponse, stateForMood, type PetState } from "@/lib/pet-sprite";

/**
 * PetSprite - 会动的宠物插画(signature interaction)
 *
 * 实现方式(whale-girl 式 AI 生图精灵图管线 + JS 帧驱动):
 * - 素材:public/pet/<state>.png 横排帧条(256px 方帧,见 lib/pet-sprite.ts)
 * - 播放:JS setInterval 推进帧索引,直接设 backgroundPosition(-帧宽×idx)。
 *   刻意不走 CSS steps() 动画——合成器对 background-position 的 steps 渲染
 *   会周期性输出空白帧(实测「出现/消失各一半」),JS 直设是 whale-girl 的成熟做法。
 * - 状态优先级:拍拍(joy) > 事件 flash > state/mood 推导。
 * - 事件(SSE worker 生命周期)→ 临时状态:游荡=think / 成功=eat / 失败=grumpy / 就绪=welcome
 * - 夜读主题:亮度滤镜适配暗纸(CSS 层,素材不变)
 */

type Mood = "curious" | "grumpy" | "playful" | "lazy" | "excited" | "emo";

/** worker 生命周期事件(useTenantEvents.lastEvent 的子集) */
export interface PetEvent {
  type:
    | "pet_ready"
    | "worker_started"
    | "worker_succeeded"
    | "worker_retry"
    | "worker_failed"
    | "worker_timeout";
  /** 事件时间戳(变化即触发,避免重复事件去重) */
  at: number;
}

/** 事件类型 → 临时状态 + 时长(ms) */
const EVENT_STATES: Record<PetEvent["type"], { state: PetState; ms: number }> = {
  pet_ready: { state: "welcome", ms: 4000 },
  worker_started: { state: "think", ms: 6000 },
  worker_succeeded: { state: "eat", ms: 3200 },
  worker_retry: { state: "grumpy", ms: 2500 },
  worker_failed: { state: "grumpy", ms: 4000 },
  worker_timeout: { state: "grumpy", ms: 4000 },
};

interface PetSpriteProps {
  mood?: Mood;
  size?: number;
  /** 指定状态(覆盖心情推导;加载态用 walk) */
  state?: PetState;
  /** 事件驱动(worker 生命周期 → 临时状态) */
  event?: PetEvent | null;
  /** 可拍拍(变成按钮;纯展示场景 false) */
  pattable?: boolean;
  /** 睡眠期（#93）：拍拍 → 哼唧/翻身回应，不醒、不打断梦境、不改展示状态 */
  sleeping?: boolean;
}

export function PetSprite({
  mood = "curious",
  size = 200,
  state,
  event = null,
  pattable = false,
  sleeping = false,
}: PetSpriteProps): React.ReactElement {
  const [patted, setPatted] = useState(false);
  const [humming, setHumming] = useState(false);
  const [flash, setFlash] = useState<{ state: PetState; until: number } | null>(null);
  const [frameIdx, setFrameIdx] = useState(0);

  // 事件 → 临时状态(事件对象变化才触发)
  useEffect(() => {
    if (!event) return;
    const mapped = EVENT_STATES[event.type];
    if (!mapped) return;
    setFlash({ state: mapped.state, until: Date.now() + mapped.ms });
  }, [event]);

  // flash 过期清理
  useEffect(() => {
    if (!flash) return;
    const remaining = flash.until - Date.now();
    if (remaining <= 0) {
      setFlash(null);
      return;
    }
    const id = setTimeout(() => setFlash(null), remaining);
    return () => clearTimeout(id);
  }, [flash]);

  // 状态优先级:拍拍 > flash > state/mood 推导
  const active: PetState = patted
    ? "joy"
    : flash
      ? flash.state
      : (state ?? stateForMood(mood));

  // JS 帧驱动:每帧时长 = 循环时长/帧数,直接位移帧条
  useEffect(() => {
    setFrameIdx(0);
    const spec = PET_STATES[active];
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const perFrame = (spec.dur * 1000) / spec.frames;
    const id = window.setInterval(() => {
      setFrameIdx((i) => (i + 1) % spec.frames);
    }, perFrame);
    return () => window.clearInterval(id);
  }, [active]);

  const pat = () => {
    // #93 睡眠期轻互动：哼唧回应（纯展示层，不触发任何状态变更）
    if (patResponse(sleeping) === "hum") {
      setHumming(true);
      setTimeout(() => setHumming(false), 1800);
    } else {
      setPatted(true);
      setTimeout(() => setPatted(false), 1600);
    }
  };

  const spec = PET_STATES[active];

  const playerStyle: React.CSSProperties = {
    width: size,
    height: size,
    backgroundImage: `url(/pet/${spec.file}.png)`,
    backgroundSize: `${spec.frames * 100}% 100%`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: `${-frameIdx * size}px 0`,
  };

  if (pattable) {
    return (
      <motion.button
        type="button"
        onClick={pat}
        className="pet-player relative cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-amber)] rounded-sm"
        style={playerStyle}
        whileTap={{ scale: 0.96 }}
        animate={humming ? { rotate: [-4, 4, -2, 0] } : { rotate: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 22 }}
        aria-label={
          sleeping
            ? `拍拍宠物(睡眠中,哼唧回应:${spec.label})`
            : `拍拍宠物(当前:${spec.label})`
        }
      >
        {humming ? (
          <span
            role="status"
            aria-live="polite"
            className="absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-sm bg-[var(--c-paper)] border border-[var(--c-engraving-fine)] px-2 py-0.5 text-xs text-text"
          >
            哼唧…
          </span>
        ) : null}
      </motion.button>
    );
  }

  return (
    <div
      className="pet-player"
      style={playerStyle}
      role="img"
      aria-label={`赛博宠物插画(${spec.label})`}
    />
  );
}
