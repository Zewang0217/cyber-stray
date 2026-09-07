import { DayClock } from "@/components/strayboy/DayClock";

/**
 * 掌机顶栏（DESIGN.md §5）：STRAY-BOY 型号铭牌 + 电源灯 + DAY/N 时钟。
 * 纯展示；N 的真实数据接线在街角票（当前为占位 DAY 1）。
 * 字体纪律：PS2P ≥12px（禁令 8）；时钟为数字走 VT323 ≥20px（DESIGN.md §3）。
 */
export function TopBar() {
  return (
    <header className="sb flex h-12 shrink-0 items-center justify-between border-b-2 border-[var(--curb)] bg-[var(--panel)] px-3">
      <div className="flex items-center gap-2">
        {/* 电源灯：闪烁类统一 steps(1) 1s 全站同频（motion.md §2），暗相 .25 保留呼吸感 */}
        <span aria-hidden className="sb-led inline-block h-2.5 w-2.5 bg-[var(--ok)]" />
        <span className="font-ps2p text-xs tracking-wider text-[var(--paper)]">
          STRAY-BOY
        </span>
      </div>
      <DayClock />
    </header>
  );
}
