"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CafeFront, NeighborCat, Passerby, ShopFront } from "./StreetLife";
import { AcUnit, LampPost, ParkCorner, ParkedCar, RoofKit, Wires, useStreetVariant } from "./StreetVariants";

/** 确定性伪随机（同 seed 同布局——避免每次渲染窗灯乱闪）。 */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

interface Building {
  left: string;
  width: number;
  height: number;
  near?: boolean;
  /** #208：挂霓虹招牌的楼（招牌 hover 亮起） */
  neon?: boolean;
}

const BUILDINGS: Building[] = [
  { left: "3%", width: 56, height: 116 },
  { left: "20%", width: 76, height: 84, near: true },
  { left: "55%", width: 64, height: 132, neon: true },
  { left: "76%", width: 90, height: 96, near: true },
];

const STARS = Array.from({ length: 12 }, (_, i) => ({
  left: `${(i * 83) % 97}%`,
  top: `${(i * 37) % 46}%`,
}));

/** 5×5 圆月格子（row, col）——像素语法月相的底盘。 */
const MOON_CELLS: Array<[number, number]> = [
  [0, 1], [0, 2], [0, 3],
  [1, 0], [1, 1], [1, 2], [1, 3], [1, 4],
  [2, 0], [2, 1], [2, 2], [2, 3], [2, 4],
  [3, 0], [3, 1], [3, 2], [3, 3], [3, 4],
  [4, 1], [4, 2], [4, 3],
];

/** 八相：左侧阴影宽度（格）——0=满月，4=娥眉；点击循环。 */
const MOON_PHASES: Array<{ name: string; shadow: number }> = [
  { name: "满月", shadow: 0 },
  { name: "亏凸月", shadow: 1 },
  { name: "下弦月", shadow: 2 },
  { name: "残月", shadow: 3 },
  { name: "新月", shadow: 4 },
  { name: "娥眉月", shadow: 3 },
  { name: "上弦月", shadow: 2 },
  { name: "盈凸月", shadow: 1 },
];

/**
 * 像素夜城街景（DESIGN.md §1 主屏）：sky/楼/窗/星/月/路缘 + 猫的活动层。
 * #208 可交互装饰：点窗灯（亮/灭）、点月亮换相、点水沟盖冒蒸汽、霓虹招牌 hover 亮。
 * 动效纪律（motion.md §5）：装饰静态定位；新增动效仅水沟盖蒸汽一处一次性
 * transform/opacity（事件触发，reduced-motion 停帧），霓虹 hover 为静态 opacity 态。
 */
export function PixelStage({ children, onStreet, demo, daytime = false, onPasserbyGreet }: { children: ReactNode; onStreet: boolean; demo?: boolean; daytime?: boolean; onPasserbyGreet?: () => void }) {
  const rand = seeded(20260906);
  const [lamps, setLamps] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState(0);
  const [steam, setSteam] = useState(0);
  const variant = useStreetVariant(); // #219：店铺街/住宅巷/公园口 按自然日轮换
  const toggleLamp = (key: string): void => {
    setLamps((prev) => ({ ...prev, [key]: !(prev[key] ?? false) }));
  };
  const moon = MOON_PHASES[phase]; // phase 经 modulo 恒在界内

  // 路人偶遇（#212）：约 45s 一次，路人出镜（夜场景）时由宿主报一句台词。
  // 门控 = !daytime 与路人渲染条件一致——不能用 onStreet（= !sleeping）：
  // onStreet 蕴含白天景，与夜出镜恒矛盾，台词将永不触发（评审 LOW-1 的修正教训）
  useEffect(() => {
    if (!onPasserbyGreet) return;
    const id = setInterval(() => {
      if (!daytime) onPasserbyGreet();
    }, 45_000);
    return () => clearInterval(id);
  }, [onPasserbyGreet, daytime]);

  return (
    <div
      className="relative h-[300px] overflow-hidden border-2 border-black"
      style={{ backgroundColor: daytime ? "#5C94FC" : "var(--sky)" }}
    >
      {/* 星/月仅夜间（宪法 §7 白天：星月隐藏） */}
      {!daytime && STARS.map((star, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute h-[2px] w-[2px] bg-[var(--star)]"
          style={{ left: star.left, top: star.top }}
        />
      ))}
      {!daytime && (
        /* 月亮：5×5 像素盘，点击循环八相（#208）；aria-label 报当前相位 */
        <button
          type="button"
          aria-label={`月亮，当前${moon.name}，点按换相`}
          onClick={() => setPhase((p) => (p + 1) % MOON_PHASES.length)}
          className="absolute right-[8%] top-[10%] z-[2] grid h-6 w-6 cursor-pointer grid-cols-5"
        >
          {Array.from({ length: 25 }, (_, i) => {
            const row = Math.floor(i / 5);
            const col = i % 5;
            const isDisc = MOON_CELLS.some(([r, c]) => r === row && c === col);
            const shadowed = col < moon.shadow;
            return (
              <b
                key={i}
                className={isDisc && !shadowed ? "bg-[var(--star)]" : "bg-transparent"}
              />
            );
          })}
        </button>
      )}
      {demo && (
        <span className="absolute right-1 top-1 z-10 border border-[var(--neon)] bg-[var(--sky)] px-1 py-0.5 font-ps2p text-xs leading-none text-[var(--neon)]">
          DEMO
        </span>
      )}
      {BUILDINGS.map((b, i) => (
        <div
          key={i}
          className={`absolute bottom-10 ${b.near ? "bg-[var(--bld-near)]" : "bg-[var(--bld-far)]"}`}
          style={{ left: b.left, width: b.width, height: b.height }}
        >
          {b.neon && variant === 0 && (
            /* 霓虹招牌（#208）：hover 亮起（静态 opacity 态，零动画） */
            <span
              aria-hidden
              className="neon-sign absolute -top-5 left-1/2 -translate-x-1/2 border border-[var(--neon)] bg-[var(--sky)] px-1 font-ps2p text-[8px] leading-[1.4] text-[var(--neon)]"
            >
              OPEN
            </span>
          )}
          {variant === 0 && i === 1 && <ShopFront />}
          {variant === 0 && i === 3 && <CafeFront />}
          {/* 住宅巷：空调外机 + 天台物件（#219） */}
          {variant === 1 && i === 2 && (
            <>
              <AcUnit top="28%" left="18%" />
              <AcUnit top="52%" left="62%" />
              <RoofKit left="30px" />
            </>
          )}
          {variant === 1 && i === 3 && <AcUnit top="36%" left="30%" />}
          {variant === 1 && i === 0 && <RoofKit left="14px" />}
          {Array.from({ length: Math.floor(b.height / 34) }, (_, row) => (
            <div key={row} className="flex gap-2 p-2">
              {Array.from({ length: Math.max(1, Math.floor((b.width - 16) / 18)) }, (_, col) => {
                const key = `${i}-${row}-${col}`;
                // rand() 必须无条件消耗：?? 短路会让被 toggle 的格跳过消耗，
                // 后续窗灯基态整体前移一位（评审 HIGH-1 实证）
                const base = rand() > 0.45;
                const lit = lamps[key] ?? base;
                return (
                  /* 点窗亮灯（#208）：基态由 seed 决定，点按在亮/灭间切换 */
                  <button
                    key={col}
                    type="button"
                    aria-label={`窗灯 ${i + 1}-${row + 1}-${col + 1}，${lit ? "亮" : "灭"}，点按切换`}
                    aria-pressed={lit}
                    onClick={() => toggleLamp(key)}
                    className={`h-2 w-2.5 cursor-pointer ${lit ? "bg-[var(--window)]" : "bg-[var(--window-off)]"}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      ))}
      {/* 街角变体氛围层（#219）：全静态，色板内取色 */}
      {variant === 0 && (
        <>
          <Wires top="28%" left="12%" width="12%" />
          <Wires top="22%" left="58%" width="16%" />
          <LampPost left="70%" />
          <ParkedCar left="40%" />
          {/* 地面反光：橱窗/霓虹在湿路面上的低透明色条 */}
          <span aria-hidden className="absolute bottom-[4px] left-[24%] h-[5px] w-[8px] bg-[var(--window)] opacity-20" />
          <span aria-hidden className="absolute bottom-[6px] left-[59%] h-[6px] w-[6px] bg-[var(--neon)] opacity-20" />
        </>
      )}
      {variant === 1 && (
        <>
          <Wires top="20%" left="6%" width="20%" />
          <Wires top="32%" left="62%" width="14%" />
          <LampPost left="88%" />
          <ParkedCar left="30%" />
        </>
      )}
      {variant === 2 && (
        <>
          <ParkCorner />
          <LampPost left="86%" />
          <Wires top="26%" left="55%" width="14%" />
        </>
      )}
      {/* 动物邻居：远处楼顶偶尔蹲一只剪影猫（#212，纯显隐无动画） */}
      {!daytime && <NeighborCat />}
      {/* 路人 NPC（#212）：剪影平移循环（transform 线性）；并发预算 = 2 路人 + 猫 = 3 */}
      {!daytime && (
        <>
          <Passerby delay="0s" duration="38s" />
          <Passerby delay="19s" duration="52s" flip />
        </>
      )}
      {/* 街道 + 路缘（猫站在路缘线上，components.md §游戏屏） */}
      <div className="absolute inset-x-0 bottom-0 h-10 border-t-2 border-[var(--curb)] bg-[var(--street)]">
        {/* 水沟盖（#208）：点按冒蒸汽（一次性事件动效） */}
        <button
          type="button"
          aria-label="路缘水沟盖，点按冒蒸汽"
          onClick={() => setSteam((n) => n + 1)}
          className="absolute bottom-2 right-[12%] h-3 w-10 cursor-pointer border-y-2 border-[var(--curb)] bg-[var(--window-off)]"
        />
        {steam > 0 && (
          <span key={steam} aria-hidden className="sb-steam absolute bottom-5 right-[13%]">
            <b /><b /><b />
          </span>
        )}
      </div>
      {/* 猫的活动层：路缘上方 */}
      <div className="absolute inset-x-0 bottom-[26px] flex justify-center">
        {children}
      </div>
      {/* 「溜达中」状态牌（游荡进行中猫出屏，spec Decision 5 边缘态） */}
      {!onStreet && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 border-2 border-[var(--ink)] bg-[var(--paper)] px-2 py-1 text-[12px] text-[var(--ink)] shadow-[4px_4px_0_#000]">
          溜达中 · 去城里找货了
        </div>
      )}
    </div>
  );
}
