"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** 首访 START 提示标记（localStorage；写入 = 已提示过，不再闪） */
const START_HINT_KEY = "sb_start_hint_seen";
/** 首访提示闪烁时长（motion.md：blink 1s steps(1)，闪 6 声足够注意到） */
const START_HINT_MS = 6_000;

const SUB_SCREENS = [
  { href: "/diary", label: "日记本" },
  { href: "/dream", label: "梦呓集" },
  { href: "/meme", label: "贴纸册" },
  { href: "/achievements", label: "成就墙" },
] as const;

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
  const [startOpen, setStartOpen] = useState(false);
  // #207：首次进入 START 键闪烁提示一次（useEffect 里读 localStorage，
  // SSR 首帧不闪——避免 hydration 类名错位）
  const [hintBlink, setHintBlink] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(START_HINT_KEY) === "1") return;
    setHintBlink(true);
    const id = setTimeout(() => {
      setHintBlink(false);
      localStorage.setItem(START_HINT_KEY, "1");
    }, START_HINT_MS);
    return () => clearTimeout(id);
  }, []);

  const openStart = (): void => {
    setStartOpen(true);
    setHintBlink(false);
    localStorage.setItem(START_HINT_KEY, "1");
  };

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
        onClick={openStart}
        className={`px-3 py-2 text-center text-[12px] leading-none text-[var(--hi)] hover:bg-[var(--street)] ${
          hintBlink ? "sb-blink" : ""
        }`}
      >
        ▶ START · 更多
      </button>
      {/* START 子屏菜单：底部面板（贴在菜单条上方，不遮底栏——反馈：全屏黑覆盖藏起 tab） */}
      {startOpen && (
        <>
          <div aria-hidden className="fixed inset-0 z-30 bg-black/60" onClick={() => setStartOpen(false)} />
          <div
            role="dialog"
            aria-label="START 子屏菜单"
            className="fixed inset-x-0 bottom-[52px] z-40 mx-auto flex max-w-sm flex-col gap-2 border-2 border-black bg-[var(--panel)] p-3 shadow-[4px_4px_0_#000] md:bottom-[68px]"
          >
            <p className="font-ps2p px-1 pb-1 text-xs text-[var(--hi)]">▶ SELECT · 更多去处</p>
            {SUB_SCREENS.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                onClick={() => setStartOpen(false)}
                className="border-2 border-[var(--curb)] bg-[var(--sky)] px-4 py-2.5 text-[14px] text-[var(--paper)] hover:border-[var(--act)]"
              >
                {s.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={() => setStartOpen(false)}
              className="border-2 border-[var(--ink)] bg-[var(--bad)] px-3 py-1.5 text-[12px] text-[var(--paper)]"
            >
              ✕ 关闭
            </button>
          </div>
        </>
      )}
    </nav>
  );
}
