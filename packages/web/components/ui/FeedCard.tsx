"use client";

import { motion } from "framer-motion";
import type { PushContent } from "@/lib/types";
import { ExternalLink } from "lucide-react";

interface FeedCardProps {
  item: PushContent;
}

/** 推送状态徽标：已推送不额外标记，其余两种需要让主人看出区别 */
function statusBadge(item: PushContent): { label: string; className: string } | null {
  if (item.gated) {
    return {
      label: "仅学习 · 未推送",
      className: "bg-subtext/10 text-subtext",
    };
  }
  if (item.pushed === false) {
    return {
      label: "推送失败",
      className: "bg-red-500/10 text-red-400",
    };
  }
  return null;
}

/**
 * 推流卡片
 * 每条抓取回来的信息卡片，带瀑布流动画入场
 * 使用语义颜色变量，避免硬编码 rgba
 */
export function FeedCard({ item }: FeedCardProps): React.ReactElement {
  const badge = statusBadge(item);

  return (
    <motion.div
      className="group p-5 rounded-2xl backdrop-blur-xl bg-mantle/[0.05] border border-white/10 overflow-hidden hover:border-accent/20 transition-colors"
      variants={{
        hidden: { opacity: 0, y: 30, scale: 0.95 },
        visible: {
          opacity: 1,
          y: 0,
          scale: 1,
          transition: {
            type: "spring",
            stiffness: 400,
            damping: 25,
          },
        },
      }}
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
    >
      {/* 悬浮发光边框 */}
      <div
        className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{
          boxShadow: `inset 0 0 0 1px oklch(0.702 0.148 326.5 / 0.2), 0 0 20px -5px oklch(0.702 0.148 326.5 / 0.15)`,
        }}
      />

      <div className="relative">
        {/* 标题与链接（碎碎念类内容没有链接，此时不渲染入口） */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="font-heading text-base font-bold text-text leading-tight">
            {item.title}
          </h3>
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 p-1.5 rounded-lg bg-surface/50 text-subtext hover:text-accent hover:bg-accent/10 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>

        {/* 摘要 */}
        <p className="text-sm text-subtext leading-relaxed mb-4">
          {item.summary}
        </p>

        {/* 人格化文案 */}
        <div className="p-3 rounded-xl bg-accent/5 border border-accent/10 mb-4">
          <p className="text-sm text-accent italic">{item.message}</p>
        </div>

        {/* 底部元信息 */}
        <div className="flex items-center justify-between gap-2 text-xs font-mono">
          <div className="flex items-center gap-2">
            {item.mood && (
              <span className="px-2 py-1 rounded-md capitalize bg-accent/10 text-accent">
                {item.mood}
              </span>
            )}
            {badge && (
              <span className={`px-2 py-1 rounded-md ${badge.className}`}>
                {badge.label}
              </span>
            )}
          </div>
          <span className="text-subtext">
            {new Date(item.timestamp).toLocaleString("zh-CN")}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
