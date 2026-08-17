"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import type { PushContent } from "@/lib/types";
import { ExternalLink, ThumbsUp, ThumbsDown, Flame } from "lucide-react";
import { useFeedback } from "@/hooks/useFeedback";

interface FeedCardProps {
  item: PushContent;
  /** 反馈成功后的回调（如刷新兴趣图谱） */
  onFeedbackDone?: () => void;
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
      className: "bg-[var(--c-state-warn)]/15 text-[var(--c-state-warn)]",
    };
  }
  return null;
}

/**
 * 采集条目卡(原推流卡片)
 * 图鉴世界:采集者笔记里新贴的发现。人格化文案 = 手写旁注(宠物的语气)。
 * staggered reveal 保留(从底部滑入 + fade + 轻缩放)。
 */
export function FeedCard({ item, onFeedbackDone }: FeedCardProps): React.ReactElement {
  const badge = statusBadge(item);
  const { submitted, pending, error, sendFeedback, boostTopic } = useFeedback();
  const [boosted, setBoosted] = useState(false);

  const handleFeedback = async (type: "like" | "dislike"): Promise<void> => {
    if (!item.messageId || pending) return;
    await sendFeedback(type, item.messageId);
    onFeedbackDone?.();
  };

  const handleBoost = async (): Promise<void> => {
    if (!item.matchedTopics?.[0] || boosted) return;
    setBoosted(true); // 乐观更新,失败回滚
    const ok = await boostTopic(item.matchedTopics[0]);
    if (!ok) setBoosted(false);
  };

  return (
    <motion.div
      className="group paper-card p-5 rounded-sm overflow-hidden hover:border-[var(--c-amber)]/60 transition-colors"
      variants={{
        hidden: { opacity: 0, y: 30, scale: 0.95 },
        visible: {
          opacity: 1,
          y: 0,
          scale: 1,
          transition: {
            type: "spring",
            stiffness: 300,
            damping: 28,
          },
        },
      }}
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
    >
      <div className="relative">
        {/* 标题与链接（碎碎念类内容没有链接，此时不渲染入口） */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="font-heading text-base font-semibold text-text leading-tight">
            {item.title}
          </h3>
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 p-1.5 rounded-sm bg-[var(--c-paper)] text-subtext hover:text-[var(--c-amber)] transition-colors border border-[var(--c-engraving-fine)]"
              aria-label="打开原文"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>

        {/* 摘要 */}
        <p className="text-sm text-subtext leading-relaxed mb-4">
          {item.summary}
        </p>

        {/* 人格化文案 = 采集者手写旁注(宠物的语气) */}
        <div className="pl-3 border-l-2 border-[var(--c-amber)]/40 mb-4">
          <p className="field-note text-base text-[var(--c-faded-ink)]">
            {item.message}
          </p>
        </div>

        {/* 推送理由（S8）：门控因子——它为什么觉得主人会感兴趣 */}
        {item.gateReasons?.length ? (
          <details className="mb-4 text-xs">
            <summary className="cursor-pointer field-note text-sm text-subtext hover:text-text select-none">
              为什么推给我？
            </summary>
            <ul className="mt-2 space-y-1 pl-3">
              {item.gateReasons.map((reason) => (
                <li key={reason} className="mono-reading text-xs text-subtext list-disc">
                  {reason}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {/* 底部元信息 */}
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            {item.mood && (
              <span className="field-note text-sm text-subtext capitalize">
                {item.mood}
              </span>
            )}
            {badge && (
              <span className={`px-2 py-0.5 rounded-sm mono-reading ${badge.className}`}>
                {badge.label}
              </span>
            )}
          </div>
          <span className="mono-reading text-xs text-subtext">
            {new Date(item.timestamp).toLocaleString("zh-CN")}
          </span>
        </div>

        {/* 反馈动作（S9）：点赞/踩驱动兴趣；顶话题显式要更多（有归因话题才可顶） */}
        <div className="flex items-center gap-2 mt-3">
          {item.messageId ? (
            <>
              <motion.button
                type="button"
                disabled={pending || submitted !== null}
                onClick={() => void handleFeedback("like")}
                className={`flex items-center gap-1 px-2 py-1 rounded-sm text-xs transition-colors border ${
                  submitted === "like"
                    ? "border-[var(--c-amber)] text-[var(--c-amber)]"
                    : "border-[var(--c-engraving-fine)] text-subtext hover:text-text hover:border-[var(--c-amber)]"
                } disabled:opacity-50`}
                animate={submitted === "like" ? { scale: [1, 1.18, 1] } : { scale: 1 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
              >
                <ThumbsUp size={12} />
                {submitted === "like" ? "已喜欢" : "喜欢"}
              </motion.button>
              <motion.button
                type="button"
                disabled={pending || submitted !== null}
                onClick={() => void handleFeedback("dislike")}
                className={`flex items-center gap-1 px-2 py-1 rounded-sm text-xs transition-colors border ${
                  submitted === "dislike"
                    ? "border-[var(--c-ink)] text-[var(--c-ink)]"
                    : "border-[var(--c-engraving-fine)] text-subtext hover:text-text"
                } disabled:opacity-50`}
                animate={submitted === "dislike" ? { scale: [1, 1.18, 1] } : { scale: 1 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
              >
                <ThumbsDown size={12} />
                {submitted === "dislike" ? "已不喜欢" : "不喜欢"}
              </motion.button>
            </>
          ) : null}
          {item.matchedTopics?.length && item.matchedTopics[0] ? (
            <button
              type="button"
              disabled={pending || boosted}
              onClick={() => void handleBoost()}
              className="flex items-center gap-1 px-2 py-1 rounded-sm text-xs transition-colors border border-[var(--c-amber)]/50 text-[var(--c-amber)] hover:border-[var(--c-amber)] disabled:opacity-50"
              title={`顶「${item.matchedTopics[0]}」——告诉它多逛这个方向`}
            >
              <Flame size={12} />
              {boosted ? "已顶" : `顶「${item.matchedTopics[0]}」`}
            </button>
          ) : null}
          {error ? <span className="text-xs text-[var(--c-state-warn)]">{error}</span> : null}
        </div>
      </div>
    </motion.div>
  );
}
