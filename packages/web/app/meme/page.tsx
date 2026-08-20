"use client";

import { useCallback } from "react";
import { motion } from "framer-motion";
import { Download, Trash2, Sparkles } from "lucide-react";
import { useMeme, type MemeEntry } from "@/hooks/useMeme";

/**
 * 表情包图鉴页（#96）：宠物自动生成的表情包集合。
 * 每张带元数据（话题/情绪/日期/模式），支持下载/删除。
 * 数据源 /api/meme（只收录过质检的——质检不过不进图鉴）。
 */
export default function MemePage(): React.ReactElement {
  const { memes, error, remove } = useMeme();

  /** 显示日期（2026-08-20 → 2026年8月20日） */
  const prettyDate = (date: string): string => {
    const y = date.slice(0, 4);
    const m = Number(date.slice(5, 7));
    const d = Number(date.slice(8, 10));
    return `${y}年${m}月${d}日`;
  };

  const handleDelete = useCallback(
    (entry: MemeEntry) => {
      // 不做 confirm 弹窗——删除可恢复性低但非破坏性（仅从图鉴移除）
      void remove(entry.id);
    },
    [remove],
  );

  return (
    <div className="spacing-lg max-w-5xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-5 h-5 text-[var(--c-amber)]" aria-hidden />
          <h1 className="font-heading text-heading font-semibold text-text">表情包图鉴</h1>
        </div>
        <p className="text-body text-subtext mb-6">
          宠物自动生成的表情包 · 每张带话题/情绪/日期 {memes ? `· 共 ${memes.length} 张` : ""}
        </p>
      </motion.div>

      {!memes ? (
        <p className="text-body text-subtext">加载中…</p>
      ) : memes.length === 0 ? (
        <motion.div className="p-6 paper-card rounded-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <p className="text-body text-subtext">
            还没有表情包——宠物会在每天睡前和推送后自动生成（过质检的才进图鉴）。
          </p>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {memes.map((m, i) => (
            <motion.div
              key={m.id}
              className="paper-card rounded-sm overflow-hidden"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.04, 0.4) }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={m.imageUrl}
                alt={`${m.topic} · ${m.emotion}`}
                className="w-full aspect-square object-contain bg-white"
                loading="lazy"
              />
              <div className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="font-heading text-body font-semibold text-text">
                    {m.topic}
                    {m.mode === "ip" ? " · IP" : ""}
                  </h2>
                  <span className="text-xs font-mono text-subtext">{prettyDate(m.date)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-small text-accent">{m.emotion}</span>
                  <div className="flex items-center gap-2">
                    {/* 下载：直接打开图片（同域，浏览器下载） */}
                    <a
                      href={m.imageUrl}
                      download
                      className="p-1.5 text-subtext hover:text-text transition-colors"
                      aria-label="下载表情包"
                    >
                      <Download className="w-4 h-4" />
                    </a>
                    <button
                      type="button"
                      onClick={() => handleDelete(m)}
                      className="p-1.5 text-subtext hover:text-danger transition-colors"
                      aria-label="删除表情包"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
      {error ? <p className="text-small text-danger mt-3">{error}</p> : null}
    </div>
  );
}
