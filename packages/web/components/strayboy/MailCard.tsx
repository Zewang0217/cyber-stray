"use client";

import { isUnread, pickStamp, stampLabel } from "@/lib/strayboy/mail";
import type { PushContent } from "@/lib/types";

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
 * 明信片（DESIGN.md §6 / components.md）：paper 底 4px 墨描边 + 实色落影、
 * 右上像素邮票、左上 mono 竖排日期签、未读 NEW! 黄徽章 steps 闪烁、
 * 标题像素短串 + 摘要 Noto Sans SC、👍/👎 + 顶话题。
 */
export function MailCard({
  card,
  adoptedAt,
  seenMs,
  onFeedback,
  onPin,
  pending,
}: {
  card: PushContent;
  adoptedAt: number;
  seenMs: number;
  onFeedback: (type: "like" | "dislike", card: PushContent) => void;
  onPin: (card: PushContent) => void;
  pending: boolean;
}) {
  const { day, hhmm } = stampLabel(card.timestamp, adoptedAt);
  const unread = isUnread(card.timestamp, seenMs);
  const title = card.title.length > 18 ? `${card.title.slice(0, 17)}…` : card.title;
  const stamp = pickStamp(card.timestamp);
  const pinTopic = card.matchedTopics?.[0];

  return (
    <article className="relative border-4 border-[var(--ink)] bg-[var(--paper)] p-4 pt-6 shadow-[6px_6px_0_#000]">
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
      <h3 className="sb mb-1.5 pl-5 pr-10 text-[15px] leading-[1.5] text-[var(--ink)]">{title}</h3>
      <p className="font-noto mb-3 pl-5 text-[13.5px] leading-[1.65] text-[#4A4238]">{card.summary}</p>
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
      </div>
    </article>
  );
}
