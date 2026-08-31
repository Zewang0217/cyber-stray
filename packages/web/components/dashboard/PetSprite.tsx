"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { PET_STATES, patResponse, stateForMood, type PetState } from "@/lib/pet-sprite";
import { proceduralMotionFor, usePetAssets } from "@/lib/pet-assets";

/**
 * PetSprite - 会动的宠物插画(signature interaction)
 *
 * 素材与播放（#95 IP 消费侧）：
 * - 有自定义 IP 素材（本租户 manifest，frames:1 单帧静态）→ 素材走
 *   /api/pet-assets/<file>（控制面鉴权服务），播放器用**程序微动画**补动：
 *   idle 呼吸(scale) / walk 位移(x) / celebrate 弹跳(y) 等，framer-motion
 *   无限循环 keyframes，不依赖多帧图。
 * - 无自定义（回退内置 public/pet，frames:3 帧条）→ JS setInterval 推进帧索引
 *   直接设 backgroundPosition（whale-girl 式帧驱动，向后兼容）。
 *   两种路径都由素材规格 spec.frames 决定，共用同一状态注册表。
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
  // #95：本租户自定义素材清单（null = 回退内置）；useReducedMotion 尊重系统减弱动效
  const { manifest } = usePetAssets();
  const reducedMotion = useReducedMotion();

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

  // #95：有自定义 → 用租户素材规格（frames:1 程序微动画）；无 → 内置（frames:3 帧驱动）
  const spec = manifest ? manifest.states[active] : PET_STATES[active];
  const isProcedural = spec.frames === 1;
  const src = manifest ? `/api/pet-assets/${spec.file}.png` : `/pet/${spec.file}.png`;

  // JS 帧驱动（仅多帧帧条素材；单帧走程序微动画，无需推进帧索引）
  useEffect(() => {
    setFrameIdx(0);
    if (isProcedural) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const perFrame = (spec.dur * 1000) / spec.frames;
    const id = window.setInterval(() => {
      setFrameIdx((i) => (i + 1) % spec.frames);
    }, perFrame);
    return () => window.clearInterval(id);
  }, [active, isProcedural, spec.dur, spec.frames]);

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

  const playerStyle: React.CSSProperties = {
    width: size,
    height: size,
    backgroundImage: `url(${src})`,
    backgroundSize: `${spec.frames * 100}% 100%`,
    backgroundRepeat: "no-repeat",
    // 单帧（程序微动画）始终显示第 0 帧；多帧由帧驱动位移
    backgroundPosition: `${isProcedural ? 0 : -frameIdx * size}px 0`,
  };

  // 程序微动画（单帧素材补动；减弱动效时停用，保持静态）
  const procedural = isProcedural && !reducedMotion ? proceduralMotionFor(active, spec.dur) : null;

  const inner = pattable ? (
    <motion.button
      type="button"
      onClick={pat}
      className="pet-player relative cursor-pointer focus:outline-none rounded-sm"
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
  ) : (
    <div
      className="pet-player"
      style={playerStyle}
      role="img"
      aria-label={`赛博宠物插画(${spec.label})`}
    />
  );

  // 程序微动画：外层 motion.div 承载补动（呼吸/位移/弹跳）；无则直接返回内容
  if (!procedural) return inner;

  return (
    <motion.div
      className="pet-player-procedural"
      style={{ width: size, height: size }}
      animate={procedural.animate}
      transition={procedural.transition}
    >
      {inner}
    </motion.div>
  );
}
