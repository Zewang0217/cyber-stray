"use client";

import { motion } from "framer-motion";
import type { PushContent } from "@/lib/types";
import { ExternalLink } from "lucide-react";

interface FeedCardProps {
  item: PushContent;
}

/**
 * 推流卡片
 * 每条抓取回来的信息卡片，带瀑布流动画入场
 * 使用语义颜色变量，避免硬编码 rgba
 */
export function FeedCard({ item }: FeedCardProps): React.ReactElement {
  return (
    <motion.div
      className="group p-5 rounded-2xl bg-mantle/60 border border-surface backdrop-blur-sm overflow-hidden hover:border-accent/20 transition-colors"
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
          boxShadow: `inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 20%, transparent), 0 0 20px -5px color-mix(in srgb, var(--color-accent) 15%, transparent)`,
        }}
      />

      <div className="relative">
        {/* 标题与链接 */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="font-heading text-base font-bold text-text leading-tight">
            {item.title}
          </h3>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 p-1.5 rounded-lg bg-surface/50 text-subtext hover:text-accent hover:bg-accent/10 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
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
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="px-2 py-1 rounded-md capitalize bg-accent/10 text-accent">
            {item.mood}
          </span>
          <span className="text-subtext">
            {new Date(item.timestamp).toLocaleString("zh-CN")}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
