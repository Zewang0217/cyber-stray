"use client";

import { useEffect } from "react";
import { stampLabel } from "@/lib/strayboy/mail";
import type { PushContent } from "@/lib/types";

/**
 * 明信片详情（#205）：墙上卡片只显标题，完整 message 正文在这里读。
 * 像素纸面语法与 MailCard 同源（paper 底墨描边 + 落影 + 邮票 + 日期签），
 * ESC / 点背景 / 返回键均可回墙上。
 */
export function PostcardDetail({
  card,
  adoptedAt,
  onFeedback,
  onPin,
  pending,
  onClose,
}: {
  card: PushContent;
  adoptedAt: number;
  onFeedback: (type: "like" | "dislike", card: PushContent) => void;
  onPin: (card: PushContent) => void;
  pending: boolean;
  onClose: () => void;
}) {
  // ESC 回墙上（挂 body 级监听，聚焦管理从简——弹层无表单）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { day, hhmm } = stampLabel(card.timestamp, adoptedAt);
  const pinTopic = card.matchedTopics?.[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3"
      role="dialog"
      aria-modal="true"
      aria-label="明信片详情"
      onClick={onClose}
    >
      <article
        className="sb relative max-h-[85vh] w-full max-w-2xl overflow-y-auto border-4 border-[var(--ink)] bg-[var(--paper)] p-4 pt-6 shadow-[6px_6px_0_#000]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 左上 mono 竖排日期签（与墙上卡片同语法） */}
        <span
          aria-hidden
          className="absolute left-1.5 top-6 font-mono text-[10px] leading-[1.2] tracking-widest text-[var(--curb)]"
          style={{ writingMode: "vertical-rl" }}
        >
          {`DAY ${day} · ${hhmm}`}
        </span>
        <h2 className="sb mb-3 pl-5 pr-10 text-[16px] leading-[1.6] text-[var(--ink)]">{card.title}</h2>
        {/* 完整正文（Noto 长文；墙上卡片不再露摘要，这里读全量） */}
        <p className="font-noto mb-4 whitespace-pre-wrap pl-5 text-[14px] leading-[1.8] text-[#4A4238]">
          {card.message}
        </p>
        <div className="flex items-center gap-2 pl-5">
          <button
            type="button"
            disabled={pending || !card.messageId}
            title={card.messageId ? "赞（归因到推送话题）" : "无渠道消息 ID，不可反馈"}
            onClick={() => onFeedback("like", card)}
            className="border-2 border-[var(--curb)] bg-[var(--panel)] px-2 py-1 text-[12px] text-[var(--paper)]"
          >
            ▲ 赞
          </button>
          <button
            type="button"
            disabled={pending || !card.messageId}
            title={card.messageId ? "踩" : "无渠道消息 ID，不可反馈"}
            onClick={() => onFeedback("dislike", card)}
            className="border-2 border-[var(--curb)] bg-[var(--panel)] px-2 py-1 text-[12px] text-[var(--paper)]"
          >
            ▼ 踩
          </button>
          {pinTopic && (
            <button
              type="button"
              disabled={pending}
              title={`顶话题：${pinTopic}`}
              onClick={() => onPin(card)}
              className="border-2 border-[var(--ink)] bg-[var(--hi)] px-2 py-1 text-[12px] text-[var(--ink)]"
            >
              ▲ {pinTopic}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto border-2 border-[var(--ink)] bg-[var(--panel)] px-2 py-1 font-ps2p text-xs text-[var(--ink)]"
          >
            ◀ 返回墙上
          </button>
        </div>
      </article>
    </div>
  );
}
