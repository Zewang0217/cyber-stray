"use client";

import { useEffect, useState } from "react";

/**
 * 街区生活层（#212 内容密度第一批）：路人 NPC / 店铺内容 / 动物邻居。
 * 装饰静态为主，动效只有路人平移循环（motion.md §5 允许项；
 * 并发预算 = 2 路人 + 猫 = 3，招牌全部静态不闪）。
 * 14 色纪律：热闹靠内容密度，招牌色全走色板（act/ok），neon 粉全屏仍 ≤1（OPEN）。
 */

/** 路人台词（偶遇猫时 DialogBox 一句； StreetCorner 传入回调消费） */
export const PASSERBY_LINES = [
  "路过的上班族：这猫比我起得还早。",
  "夜班回来了：又是它，蹲得像个路灯。",
  "遛弯大爷：好家伙，比我孙子还精神。",
  "放学的娃：妈！这只猫会看店！",
] as const;

/** 路人 NPC：像素小人剪影，街面平移循环（transform 线性，无逐帧属性） */
export function Passerby({ delay, duration, flip }: { delay: string; duration: string; flip?: boolean }) {
  return (
    <div
      aria-hidden
      className="sb-passerby absolute bottom-[30px] z-[3]"
      style={{ animationDelay: delay, animationDuration: duration }}
      data-flip={flip ? "true" : "false"}
    >
      {/* 头 + 身 + 腿（steps 双帧摆腿）；14 色纪律内：剪影用 --ink */}
      <span className="mx-auto block h-[6px] w-[6px] bg-[var(--ink)]" />
      <span className="mx-auto block h-[10px] w-[8px] bg-[var(--ink)]" />
      <span className="sb-passerby-legs mx-auto flex w-[8px] justify-between">
        <b className="h-[5px] w-[3px] bg-[var(--ink)]" />
        <b className="h-[5px] w-[3px] bg-[var(--ink)]" />
      </span>
    </div>
  );
}

/** 便利店门面：橱窗货架 + 遮阳棚 + 色板招牌（静态，无动效） */
export function ShopFront() {
  return (
    <div aria-hidden className="absolute inset-x-0 bottom-0">
      {/* 遮阳棚：ok 绿白条 */}
      <div className="mx-1 flex h-[6px]">
        {Array.from({ length: 6 }, (_, i) => (
          <b key={i} className={`flex-1 ${i % 2 ? "bg-[var(--ok)]" : "bg-[var(--paper)]"}`} />
        ))}
      </div>
      {/* 橱窗：货架上摆商品色块（window 黄 / act 蓝 / ok 绿） */}
      <div className="mx-1 mt-[2px] flex h-[16px] items-end gap-[2px] border border-[var(--curb)] bg-[var(--window)] p-[2px]">
        {[0, 1, 2].map((shelf) => (
          <span key={shelf} className="flex flex-1 flex-col justify-end gap-[2px]">
            {["bg-[var(--bad)]", "bg-[var(--act)]", "bg-[var(--ok)]"].map((c, k) => (
              <b key={k} className={`h-[3px] ${c}`} />
            ))}
          </span>
        ))}
      </div>
      <p className="mt-[2px] text-center font-ps2p text-[7px] leading-none text-[var(--act)]">便利</p>
    </div>
  );
}

/** 咖啡门面：暖窗 + 咖啡杯像素画 + 色板招牌 */
export function CafeFront() {
  return (
    <div aria-hidden className="absolute inset-x-0 bottom-0">
      <div className="mx-1 mt-[2px] flex h-[16px] items-center justify-center gap-[2px] border border-[var(--curb)] bg-[var(--bld-near)]">
        {/* 杯身 + 杯柄 + 热气（全静态） */}
        <span className="flex flex-col items-center">
          <b className="h-[6px] w-[7px] border border-[var(--paper)] bg-[var(--paper)]" />
          <b className="h-[2px] w-[9px] bg-[var(--paper)]" />
        </span>
        <span className="flex flex-col gap-[2px] pb-[2px]">
          <b className="h-[1px] w-[3px] bg-[var(--curb)]" />
          <b className="h-[1px] w-[3px] bg-[var(--curb)]" />
        </span>
      </div>
      <p className="mt-[2px] text-center font-ps2p text-[7px] leading-none text-[var(--ok)]">珈琲</p>
    </div>
  );
}

/** 动物邻居：远处楼顶剪影猫——12s 翻转显隐（约 24s 周期出镜一次），纯静态无动画 */
export function NeighborCat() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    // 出镜节奏：40s 周期里亮 12s（无动画，纯显隐；随机相位避免与路人同步）
    const id = setInterval(() => {
      setVisible((v) => !v);
    }, 12_000);
    setVisible(Math.random() > 0.5);
    return () => clearInterval(id);
  }, []);
  if (!visible) return null;
  return (
    <span
      aria-hidden
      className="absolute left-[4%] z-[1] flex flex-col items-center"
      style={{ bottom: "146px" }}
    >
      {/* 耳朵/头/身体/尾巴：剪影 */}
      <span className="flex w-[6px] justify-between">
        <b className="h-[2px] w-[2px] bg-[var(--ink)]" />
        <b className="h-[2px] w-[2px] bg-[var(--ink)]" />
      </span>
      <b className="h-[4px] w-[6px] bg-[var(--ink)]" />
      <b className="h-[6px] w-[8px] bg-[var(--ink)]" />
      <b className="-ml-[6px] h-[1px] w-[5px] bg-[var(--ink)]" />
    </span>
  );
}
