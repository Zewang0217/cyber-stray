import type { ReactNode } from "react";

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
}

const BUILDINGS: Building[] = [
  { left: "3%", width: 56, height: 116 },
  { left: "20%", width: 76, height: 84, near: true },
  { left: "55%", width: 64, height: 132 },
  { left: "76%", width: 90, height: 96, near: true },
];

const STARS = Array.from({ length: 12 }, (_, i) => ({
  left: `${(i * 83) % 97}%`,
  top: `${(i * 37) % 46}%`,
}));

/**
 * 像素夜城街景（DESIGN.md §1 主屏）：sky/楼/窗/星/路缘 + 猫的活动层。
 * 装饰全部静态定位（motion.md §5），只有窗灯允许闪烁；月相/作息联动随 delight 票。
 */
export function PixelStage({ children, onStreet, demo }: { children: ReactNode; onStreet: boolean; demo?: boolean }) {
  const rand = seeded(20260906);
  return (
    <div className="relative h-[300px] overflow-hidden border-2 border-black bg-[var(--sky)]">
      {STARS.map((star, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute h-[2px] w-[2px] bg-[var(--star)]"
          style={{ left: star.left, top: star.top }}
        />
      ))}
      {/* 月亮：方块（像素语法；真实月相随 delight 票） */}
      <span aria-hidden className="absolute right-[8%] top-[10%] h-6 w-6 bg-[var(--star)]" />
      {demo && (
        <span className="absolute right-1 top-1 z-10 border border-[var(--neon)] bg-[var(--sky)] px-1 py-0.5 font-ps2p text-xs leading-none text-[var(--neon)]">
          DEMO
        </span>
      )}
      {BUILDINGS.map((b, i) => (
        <div
          key={i}
          aria-hidden
          className={`absolute bottom-10 ${b.near ? "bg-[var(--bld-near)]" : "bg-[var(--bld-far)]"}`}
          style={{ left: b.left, width: b.width, height: b.height }}
        >
          {Array.from({ length: Math.floor(b.height / 34) }, (_, row) => (
            <div key={row} className="flex gap-2 p-2">
              {Array.from({ length: Math.max(1, Math.floor((b.width - 16) / 18)) }, (_, col) => {
                const lit = rand() > 0.45;
                return (
                  <span
                    key={col}
                    className={`h-2 w-2.5 ${lit ? "bg-[var(--window)]" : "bg-[var(--window-off)]"}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      ))}
      {/* 街道 + 路缘（猫站在路缘线上，components.md §游戏屏） */}
      <div className="absolute inset-x-0 bottom-0 h-10 border-t-2 border-[var(--curb)] bg-[var(--street)]" />
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
