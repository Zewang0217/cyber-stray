"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  Activity,
  History,
  Terminal,
  Settings,
  Dog,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItemConfig {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItemConfig[] = [
  { label: "仪表盘", href: "/", icon: Activity },
  { label: "历史推送", href: "/history", icon: History },
  { label: "终端日志", href: "/logs", icon: Terminal },
  { label: "设置", href: "/settings", icon: Settings },
];

/**
 * 侧边栏导航
 * 玻璃态 Mantle 背景，磁性悬浮效果
 */
export function Sidebar(): React.ReactElement {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 h-full w-64 z-50 flex flex-col">
      {/* 玻璃背景 */}
      <div className="absolute inset-0 backdrop-blur-xl bg-mantle/[0.08] border-r border-white/10" />

      <div className="relative flex flex-col h-full p-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 mb-10 group">
          <motion.div
            whileHover={{ rotate: [0, -10, 10, 0] }}
            transition={{ duration: 0.5 }}
          >
            <Dog className="w-8 h-8 text-accent" />
          </motion.div>
          <div>
            <h1
              className="font-heading text-xl font-bold tracking-tight text-text"
              style={{ letterSpacing: "-0.04em" }}
            >
              Cyber Stray
            </h1>
            <p className="text-[10px] text-subtext font-mono uppercase tracking-widest">
              赛博街溜子
            </p>
          </div>
        </Link>

        {/* 导航链接 */}
        <nav className="flex-1 space-y-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;

            return (
              <Link key={item.href} href={item.href} className="block">
                <motion.div
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl transition-colors",
                    "border border-transparent",
                    isActive
                      ? "bg-accent/10 text-accent border-accent/20"
                      : "text-subtext hover:text-text hover:bg-surface/50"
                  )}
                  whileHover={{ x: 4 }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-medium text-sm">{item.label}</span>
                  {isActive && (
                    <motion.div
                      layoutId="activeNav"
                      className="absolute left-0 w-1 h-6 bg-accent rounded-r-full"
                      transition={{ type: "spring", stiffness: 400, damping: 25 }}
                    />
                  )}
                </motion.div>
              </Link>
            );
          })}
        </nav>

        {/* 底部状态 */}
        <div className="pt-4 border-t border-surface">
          <div className="flex items-center gap-2 text-xs text-subtext font-mono">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            Agent Online
          </div>
        </div>
      </div>
    </aside>
  );
}
