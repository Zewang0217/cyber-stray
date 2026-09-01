"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  History,
  Settings,
  TrendingUp,
  ShieldCheck,
  Footprints,
  BookOpen,
  NotebookPen,
  Sparkles,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";

interface NavItemConfig {
  label: string;
  latin: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItemConfig[] = [
  { label: "首页", latin: "Tabula", href: "/", icon: BookOpen },
  { label: "历史推送", latin: "Annotationes", href: "/history", icon: History },
  { label: "日记", latin: "Ephemeris", href: "/diary", icon: NotebookPen },
  { label: "表情包", latin: "Mimica", href: "/meme", icon: Sparkles },
  { label: "足迹", latin: "Itinerarium", href: "/footprint", icon: Footprints },
  { label: "进化", latin: "Evolutio", href: "/evolution", icon: TrendingUp },
  { label: "设置", latin: "Praefatio", href: "/settings", icon: Settings },
  { label: "管理面板", latin: "Administratio", href: "/admin", icon: ShieldCheck },
];

/** 图鉴标题块(桌面侧栏与移动抽屉共用) */
function BrandBlock(): React.ReactElement {
  return (
    <Link href="/" className="block mb-8">
      <p className="field-note text-sm text-subtext mb-1">Cyber Stray</p>
      <h1
        className="font-heading text-2xl font-semibold text-text"
        style={{ letterSpacing: "-0.01em" }}
      >
        赛博街溜子
      </h1>
      <div className="engraving-rule mt-2" />
      <p className="field-note text-xs mt-2">自然博物图鉴</p>
    </Link>
  );
}

/** 目录列表(共用) */
function NavList({ onNavigate }: { onNavigate?: () => void }): React.ReactElement {
  const pathname = usePathname();
  return (
    <nav>
      <p className="field-note text-xs text-subtext mb-2 uppercase tracking-wider">
        目录
      </p>
      <ul className="space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link href={item.href} className="block" onClick={onNavigate}>
                <motion.div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-sm transition-colors",
                    isActive
                      ? "bg-[var(--c-paper)] text-text"
                      : "text-subtext hover:text-text hover:bg-[var(--c-paper)]",
                  )}
                  whileHover={{ x: 2 }}
                  transition={{ type: "spring", stiffness: 300, damping: 28 }}
                >
                  {isActive ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--c-amber)] animate-[var(--animate-amber-breath)] shrink-0" />
                  ) : (
                    <Icon className="w-4 h-4 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-heading text-sm font-medium">{item.label}</div>
                    <div className="field-note text-xs text-subtext italic">
                      {item.latin}
                    </div>
                  </div>
                </motion.div>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** 底部状态(共用) */
function FooterBlock(): React.ReactElement {
  return (
    <div className="pt-4 mt-4 border-t border-[var(--c-engraving-fine)] space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-subtext mono-reading">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--c-amber)] animate-[var(--animate-amber-breath)]" />
          在线
        </div>
        <ThemeToggle />
      </div>
      <form action="/api/auth/logout" method="POST">
        <button
          type="submit"
          className="w-full text-left field-note text-sm text-subtext hover:text-text transition-colors"
        >
          → 登出
        </button>
      </form>
    </div>
  );
}

/**
 * 图鉴目录侧栏(桌面) + 顶栏/抽屉(移动)
 * 双端均重:lg+ 固定侧栏;移动端顶栏 + 左滑抽屉目录。
 * 铜版画边框 + 衬线标题 + 手写页码,废弃玻璃态。
 */
export function Sidebar(): React.ReactElement {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      {/* 桌面:固定侧栏 */}
      <aside className="hidden lg:flex fixed left-0 top-0 h-full w-64 z-nav flex-col">
        <div className="absolute inset-0 bg-mantle border-r border-[var(--c-engraving-fine)]" />
        <div className="relative flex flex-col h-full p-6">
          <BrandBlock />
          <div className="flex-1">
            <NavList />
          </div>
          <FooterBlock />
        </div>
      </aside>

      {/* 移动:顶栏 */}
      <header className="lg:hidden fixed top-0 inset-x-0 z-nav bg-mantle border-b border-[var(--c-engraving-fine)]">
        <div className="flex items-center justify-between px-4 h-14">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="font-heading text-lg font-semibold text-text">
              赛博街溜子
            </span>
            <span className="field-note text-xs text-subtext hidden sm:inline">
              自然博物图鉴
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="p-2 rounded-sm bg-[var(--c-paper)] border border-[var(--c-engraving-fine)] text-text"
              aria-label="打开目录"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* 移动:抽屉目录 */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              className="lg:hidden fixed inset-0 z-drawer-overlay bg-[var(--c-ink)]/30"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawerOpen(false)}
            />
            <motion.div
              className="lg:hidden fixed left-0 top-0 h-full w-72 z-drawer bg-mantle border-r border-[var(--c-engraving-fine)] p-6 overflow-y-auto"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            >
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="absolute right-4 top-4 p-1 text-subtext hover:text-text"
                aria-label="关闭目录"
              >
                <X className="w-5 h-5" />
              </button>
              <BrandBlock />
              <NavList onNavigate={() => setDrawerOpen(false)} />
              <FooterBlock />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
