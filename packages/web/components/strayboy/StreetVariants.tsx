"use client";

import { useEffect, useState } from "react";

/**
 * 街角变体层（#219 氛围与场景轮换）：店铺街 / 住宅巷 / 公园口 三套，
 * 按自然日轮换（dayNumber % 3）——猫在熟悉与陌生之间游荡。
 * 全静态装饰（motion.md §5：路灯光锥/反光/物件零动画）；变体经 useEffect
 * 求日期（SSR/客户端时区一致才有同值，挂载前渲染中性基础层防 hydration 错位）。
 * 14 色纪律：暖光用 --window 黄低透明，反光用 --curb，无新色。
 */

/** 自然日序数（UTC 基准；轮换只求「每天不同」，不要求本地语义） */
function dayNumber(now = new Date()): number {
  return Math.floor(now.getTime() / 86_400_000);
}

/** 路灯：灯杆 + 暖光锥（clip-path 三角，静态低透明） */
export function LampPost({ left }: { left: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute bottom-10 z-[2]" style={{ left }}>
      <span className="absolute -top-[64px] left-0 h-[64px] w-[3px] bg-[var(--curb)]" />
      <span className="absolute -top-[66px] -left-[3px] h-[3px] w-[9px] bg-[var(--window)]" />
      {/* 光锥：暖黄低透明三角（静态；宪法禁 blur，两层阶梯近似渐变） */}
      <span
        className="absolute -top-[63px] -left-[16px] h-[58px] w-[38px] bg-[var(--window)] opacity-[0.10]"
        style={{ clipPath: "polygon(38% 0, 62% 0, 100% 100%, 0 100%)" }}
      />
      <span
        className="absolute -top-[63px] -left-[10px] h-[58px] w-[26px] bg-[var(--window)] opacity-[0.12]"
        style={{ clipPath: "polygon(38% 0, 62% 0, 100% 100%, 0 100%)" }}
      />
    </div>
  );
}

/** 停靠车辆：像素轿车剪影（静态；wheels = --ink，车身 = --bld-near 描边 curb） */
export function ParkedCar({ left }: { left: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute bottom-[14px] z-[2]" style={{ left }}>
      <span className="flex items-end">
        <b className="h-[6px] w-[26px] bg-[var(--bld-near)] border-2 border-[var(--curb)]" />
        <b className="-ml-[2px] h-[4px] w-[12px] border-2 border-b-0 border-[var(--curb)] bg-[var(--bld-near)]" />
      </span>
      <span className="flex w-[34px] justify-between px-[3px]">
        <b className="h-[5px] w-[5px] bg-[var(--ink)]" />
        <b className="h-[5px] w-[5px] bg-[var(--ink)]" />
      </span>
    </div>
  );
}

/** 电线：两楼之间的下垂线（三段折线近似弧，1px curb 色） */
export function Wires({ top, left, width }: { top: string; left: string; width: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute z-[1]" style={{ top, left, width }}>
      <span className="block h-[1px] w-full bg-[var(--curb)] opacity-70" />
      <span className="mx-auto block h-[1px] w-[70%] bg-[var(--curb)] opacity-70" style={{ marginTop: 2 }} />
      <span className="mx-auto block h-[1px] w-[40%] bg-[var(--curb)] opacity-70" style={{ marginTop: 2 }} />
    </div>
  );
}

/** 天台物件：水箱 + 天线（挂楼顶） */
export function RoofKit({ left }: { left: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute z-[1] flex items-end gap-2" style={{ left, top: "-10px" }}>
      <span className="flex flex-col items-center">
        <b className="h-[1px] w-[8px] bg-[var(--curb)]" />
        <b className="h-[8px] w-[10px] border border-[var(--curb)] bg-[var(--bld-far)]" />
      </span>
      <span className="flex flex-col items-center">
        <b className="h-[6px] w-[1px] bg-[var(--curb)]" />
        <b className="h-[3px] w-[7px] bg-[var(--curb)]" />
      </span>
    </div>
  );
}

/** 空调外机：挂墙格栅小盒 */
export function AcUnit({ top, left }: { top: string; left: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute z-[1] h-[6px] w-[9px] border border-[var(--curb)] bg-[var(--bld-far)]"
      style={{ top, left }}
    >
      <b className="absolute bottom-[1px] left-[1px] h-[1px] w-[6px] bg-[var(--curb)]" />
    </span>
  );
}

/** 公园口：像素树 + 长椅 */
export function ParkCorner() {
  return (
    <div aria-hidden className="pointer-events-none absolute bottom-10 z-[2]" style={{ left: "8%" }}>
      {/* 树：干 + 两层冠 */}
      <span className="absolute bottom-0 left-[6px] h-[18px] w-[4px] bg-[var(--curb)]" />
      <span className="absolute bottom-[14px] left-0 h-[10px] w-[16px] bg-[var(--ok)] opacity-80" />
      <span className="absolute bottom-[22px] left-[3px] h-[7px] w-[10px] bg-[var(--ok)]" />
      {/* 长椅 */}
      <span className="absolute bottom-[2px] left-[40px] flex flex-col items-center">
        <b className="h-[1px] w-[18px] bg-[var(--curb)]" />
        <b className="h-[5px] w-[18px] border border-[var(--curb)] bg-[var(--bld-far)]" />
        <b className="h-[4px] w-[16px] border-x-2 border-[var(--curb)] bg-[var(--street)]" />
      </span>
    </div>
  );
}

/**
 * 变体选择 hook：挂载后按自然日定变体（0 店铺街 / 1 住宅巷 / 2 公园口）。
 * 返回 null = 未挂载（渲染中性基础层，防 hydration 错位）。
 */
export function useStreetVariant(): 0 | 1 | 2 | null {
  const [variant, setVariant] = useState<0 | 1 | 2 | null>(null);
  useEffect(() => {
    setVariant(dayNumber() % 3 as 0 | 1 | 2);
  }, []);
  return variant;
}
