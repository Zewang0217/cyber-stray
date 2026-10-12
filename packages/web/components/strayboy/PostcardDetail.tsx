"use client";

import { useEffect, useRef, useState } from "react";
import { stampLabel } from "@/lib/strayboy/mail";
import { getSpeakSourceUrl, type SpeakHistoryItem } from "@cyber-stray/shared/push";
import { FeedbackBurst } from "./FeedbackBurst";
import { PostcardMarkdown } from "./PostcardMarkdown";
import { PostcardMeme } from "./PostcardMeme";

/**
 * 明信片详情：完整标题与安全 Markdown 正文在这里读。
 * 像素纸面语法与 MailCard 同源（paper 底墨描边 + 落影 + 邮票 + 日期签），
 * ESC / 点背景 / 返回键均可回墙上。
 */
export function PostcardDetail({
  card,
  myType,
  onFeedback,
  onPin,
  pending,
  onClose,
}: {
  card: SpeakHistoryItem;
  /** 本地已提交的反馈类型（与墙上卡片同源状态） */
  myType?: "like" | "dislike";
  onFeedback: (type: "like" | "dislike", card: SpeakHistoryItem) => void;
  onPin: (card: SpeakHistoryItem) => void;
  pending: boolean;
  onClose: () => void;
}) {
  // 反馈落定 burst：与 MailCard 同款（详情里点赞也飘爱心）
  const [burst, setBurst] = useState<"like" | "dislike" | null>(null);
  const prevType = useRef(myType);
  useEffect(() => {
    if (prevType.current !== myType && myType) setBurst(myType);
    prevType.current = myType;
  }, [myType]);
  useEffect(() => {
    if (!burst) return;
    const id = setTimeout(() => setBurst(null), 450);
    return () => clearTimeout(id);
  }, [burst]);
  // ESC 回墙上（挂 body 级监听，聚焦管理从简——弹层无表单）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { date, hhmm } = stampLabel(card.timestamp);
  const pinTopic = card.matchedTopics?.[0];
  const sourceUrl = getSpeakSourceUrl(card.url);

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
          {`${date} · ${hhmm}`}
        </span>
        <h2 className="font-noto mb-4 min-w-0 [overflow-wrap:anywhere] text-balance pl-5 pr-10 text-[20px] font-bold leading-[1.55] text-[var(--ink)]">{card.title}</h2>
        <div className="font-noto mb-4 min-w-0 break-words pl-5 text-[15px] leading-[1.8] text-[var(--ink-soft)]">
          <PostcardMarkdown text={card.message} />
        </div>
        {card.memeImageUrl && <PostcardMeme imageUrl={card.memeImageUrl} />}
        {sourceUrl && (
          <p className="mb-4 pl-5 text-[14px]">
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
              className="text-[var(--act)] underline underline-offset-4">阅读原文 ↗</a>
          </p>
        )}
        <div className="relative flex items-center gap-2 pl-5">
          {burst && <FeedbackBurst type={burst} />}
          <button
            type="button"
            disabled={pending || !card.messageId}
            aria-pressed={myType === "like"}
            title={card.messageId ? "赞（归因到推送话题）" : "这张旧明信片暂不支持反馈"}
            onClick={() => onFeedback("like", card)}
            className={`border-2 px-2 py-1 text-[12px] shadow-[2px_2px_0_#000] transition-none active:translate-x-[1px] active:translate-y-[1px] active:shadow-none disabled:shadow-none disabled:opacity-60 ${
              myType === "like"
                ? "border-[var(--ink)] bg-[var(--hi)] font-bold text-[var(--ink)]"
                : "border-[var(--curb)] bg-[var(--panel)] text-[var(--paper)]"
            }`}
          >
            {myType === "like" ? "▲ 已赞" : "▲ 赞"}
          </button>
          <button
            type="button"
            disabled={pending || !card.messageId}
            aria-pressed={myType === "dislike"}
            title={card.messageId ? "踩" : "这张旧明信片暂不支持反馈"}
            onClick={() => onFeedback("dislike", card)}
            className={`border-2 px-2 py-1 text-[12px] shadow-[2px_2px_0_#000] transition-none active:translate-x-[1px] active:translate-y-[1px] active:shadow-none disabled:shadow-none disabled:opacity-60 ${
              myType === "dislike"
                ? "border-[var(--ink)] bg-[var(--curb)] font-bold text-[var(--paper)]"
                : "border-[var(--curb)] bg-[var(--panel)] text-[var(--paper)]"
            }`}
          >
            {myType === "dislike" ? "▼ 已踩" : "▼ 踩"}
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
            className="ml-auto border-2 border-[var(--ink)] bg-[var(--panel)] px-2 py-1 font-ps2p text-xs text-[var(--paper)]"
          >
            ◀ 返回墙上
          </button>
        </div>
      </article>
    </div>
  );
}
