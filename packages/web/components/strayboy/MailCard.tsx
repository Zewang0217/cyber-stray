"use client";

import { isUnread, pickStamp, stampLabel } from "@/lib/strayboy/mail";
import { getSpeakSourceUrl, SPEAK_TYPE_LABELS, type SpeakHistoryItem } from "@cyber-stray/shared/push";
import { PostcardMarkdown } from "./PostcardMarkdown";
import { PostcardMeme } from "./PostcardMeme";

/** 邮票 4 款（16×16 像素画语法：小方格拼绘，禁平滑图标）。 */
function Stamp({ kind }: { kind: string }) {
  const grids: Record<string, Array<[number, number]>> = {
    "cat-paw": [[1, 1], [3, 1], [0, 2], [2, 2], [1, 3], [2, 3], [3, 3]],
    perforation: [[0, 0], [3, 0], [0, 3], [3, 3], [1, 1], [2, 2], [2, 1], [1, 2]],
    block: [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [3, 1], [0, 2], [3, 2], [0, 3], [1, 3], [2, 3], [3, 3]],
    moon: [[1, 0], [2, 0], [2, 1], [3, 1], [2, 2], [3, 2], [1, 3], [2, 3]],
  };
  const cells = grids[kind] ?? grids.moon;
  return (
    <span
      aria-hidden
      className="grid h-8 w-8 grid-cols-4 gap-[1px] border-2 border-dotted border-[var(--ink)] bg-[var(--paper)] p-[2px]"
    >
      {Array.from({ length: 16 }, (_, i) => {
        const x = i % 4;
        const y = Math.floor(i / 4);
        const on = cells.some(([cx, cy]) => cx === x && cy === y);
        return <b key={i} className={on ? "bg-[var(--bld-near)]" : "bg-transparent"} />;
      })}
    </span>
  );
}

/**
 * 明信片（docs/design-v3/DESIGN.md §6 / components.md §MailCard #205 修订）：paper 底 4px 墨描边 +
 * 实色落影、右上像素邮票、左上 mono 竖排日期签、未读 NEW! 黄徽章 steps 闪烁、
 * 卡片展示完整标题与摘要，点开 PostcardDetail 读全文。
 */
export function MailCard({
  card,
  adoptedAt,
  seenMs,
  onFeedback,
  onPin,
  pending,
  onOpen,
}: {
  card: SpeakHistoryItem;
  adoptedAt: number;
  seenMs: number;
  onFeedback: (type: "like" | "dislike", card: SpeakHistoryItem) => void;
  onPin: (card: SpeakHistoryItem) => void;
  pending: boolean;
  /** 点卡片标题或打开全文进详情 */
  onOpen: (card: SpeakHistoryItem) => void;
}) {
  const { day, hhmm } = stampLabel(card.timestamp, adoptedAt);
  const unread = isUnread(card.timestamp, seenMs);
  const stamp = pickStamp(card.timestamp);
  const pinTopic = card.matchedTopics?.[0];
  const sourceUrl = getSpeakSourceUrl(card.url);

  return (
    <article className="relative min-w-0 border-4 border-[var(--ink)] bg-[var(--paper)] p-4 pt-6 shadow-[6px_6px_0_#000]">
      {/* 左上 mono 竖排日期签 */}
      <span
        aria-hidden
        className="absolute left-1.5 top-6 font-mono text-[10px] leading-[1.2] tracking-widest text-[var(--curb)]"
        style={{ writingMode: "vertical-rl" }}
      >
        {`DAY ${day} · ${hhmm}`}
      </span>
      {/* 右上像素邮票 */}
      <span className="absolute right-3 top-3 rotate-3">
        <Stamp kind={stamp} />
      </span>
      {/* 未读 NEW! 黄徽章 */}
      {unread && (
        <span className="sb-blink absolute -left-2 -top-3 border-2 border-[var(--ink)] bg-[var(--hi)] px-1.5 py-0.5 font-ps2p text-xs leading-none text-[var(--ink)]">
          NEW!
        </span>
      )}
      {(card.type || pinTopic) && <div className="mb-3 flex flex-wrap gap-2 pl-5 pr-10 font-mono text-[11px] text-[var(--curb)]">
        {card.type && <span>{SPEAK_TYPE_LABELS[card.type]}</span>}
        {pinTopic && <span>#{pinTopic}</span>}
      </div>}
      <h3 className="mb-3 min-w-0 pl-5 pr-10">
        <button
          type="button"
          onClick={() => onOpen(card)}
          className="font-noto block min-w-0 w-full pr-2 [overflow-wrap:anywhere] text-balance text-left text-[17px] font-bold leading-[1.55] text-[var(--ink)] underline decoration-dotted decoration-[var(--curb)] underline-offset-4"
        >
          {card.title}
        </button>
      </h3>
      <div aria-label="正文预览" className="font-noto mb-4 max-h-28 overflow-hidden break-words pl-5 text-[14px] leading-[1.7] text-[var(--ink-soft)]">
        <PostcardMarkdown text={card.message} />
      </div>
      {card.memeImageUrl && <PostcardMeme imageUrl={card.memeImageUrl} />}
      <div className="mb-4 flex flex-wrap items-center gap-3 border-t-2 border-[var(--curb)] pt-3 pl-5 text-[13px]">
        <button type="button" onClick={() => onOpen(card)} className="font-noto font-bold text-[var(--act)] underline underline-offset-4">打开全文 →</button>
        {sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
          className="font-noto text-[var(--act)] underline underline-offset-4">阅读原文 ↗</a>}
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-5">
        <button
          type="button"
          disabled={pending || !card.messageId}
          title={card.messageId ? "赞（归因到推送话题）" : "这张旧明信片暂不支持反馈"}
          onClick={() => onFeedback("like", card)}
          className="border-2 border-[var(--curb)] bg-[var(--panel)] px-2 py-1 text-[12px] text-[var(--paper)]"
        >
          ▲ 赞
        </button>
        <button
          type="button"
          disabled={pending || !card.messageId}
          title={card.messageId ? "踩" : "这张旧明信片暂不支持反馈"}
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
      </div>
    </article>
  );
}
