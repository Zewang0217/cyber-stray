"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "街角" },
  { href: "/history", label: "墙上" },
  { href: "/evolution", label: "图鉴" },
  { href: "/settings", label: "设置" },
] as const;

/**
 * 游戏菜单条（DESIGN.md §5 / #170 全局骨架 1）：4 tab + START 键。
 * 桌面底部居中悬浮、移动端底部通栏（demo 为准）；子屏（日记/梦呓/贴纸册）
 * 由 START 打开——子屏票（T1-7）接线，当前仅键位占位。
 */
export function MenuBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="游戏菜单"
      className="sb fixed inset-x-0 bottom-0 z-40 flex items-stretch gap-1 border-2 border-black bg-[var(--panel)] p-1 shadow-[0_-2px_0_rgba(0,0,0,0.4)] md:inset-x-auto md:bottom-3 md:left-1/2 md:-translate-x-1/2 md:shadow-[4px_4px_0_#000]"
    >
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`px-3 py-2 text-center text-[12px] leading-none ${
              active
                ? "bg-[var(--act)] text-[var(--sky)]"
                : "text-[var(--paper)] hover:bg-[var(--street)]"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
      <button
        type="button"
        title="START · 子屏菜单随 T1-7 接线"
        className="px-3 py-2 text-center text-[12px] leading-none text-[var(--hi)] hover:bg-[var(--street)]"
      >
        ▶ START
      </button>
    </nav>
  );
}
