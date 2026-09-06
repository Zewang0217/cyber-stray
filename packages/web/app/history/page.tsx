"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { useFeedback } from "@/hooks/useFeedback";
import { useHistory } from "@/hooks/useHistory";
import { usePets } from "@/hooks/usePets";
import { useTenantEvents } from "@/hooks/useTenantEvents";
import { MailCard } from "@/components/strayboy/MailCard";
import { DAY_MS, getSeenTimestamp, markAllSeen } from "@/lib/strayboy/mail";
import type { PushContent } from "@/lib/types";


/** 演示夹具（?demo=1）：无会话时的墙上视觉验收数据。 */
const DEMO_CARDS: PushContent[] = [
  {
    message: "帖子全文……", timestamp: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    title: "科学实锤：猫能听懂自己的名字", summary: "新研究覆盖 78 只猫。听懂率 94%，回应率 11%——这不是 bug，是性格。",
    messageId: "demo-1", matchedTopics: ["猫行为学"], pushed: true,
  },
  {
    message: "教程全文……", timestamp: new Date(Date.now() - 26 * 3_600_000).toISOString(),
    title: "有猫在深夜偷偷运行了一台复古掌机", summary: "一篇被转疯的教程：如何用现代零件复活一台 STRAY-BOY。",
    messageId: "demo-2", matchedTopics: ["复古掌机"], pushed: true,
  },
  {
    message: "评测全文……", timestamp: new Date(Date.now() - 2 * DAY_MS).toISOString(),
    title: "2026 像素画工具横评", summary: "从 Aseprite 到浏览器像素编辑器，九款工具的取舍。",
    messageId: "demo-3", pushed: true,
  },
];

/**
 * 墙上（/history，#170 映射）：明信片墙 + 未读推导 + 到达编排（toast + 轻震动）。
 * 反馈/置顶走真实 CP API（useFeedback）；?demo=1 夹具通道同街角。
 */
function WallInner() {
  const demo = useSearchParams().get("demo") === "1";
  const live = useTenantEvents({ enabled: !demo });
  const history = useHistory({ refreshSignal: live.refreshSignal, realtimeConnected: live.connected });
  const { pets } = usePets();
  const feedback = useFeedback();
  const adoptedAt = pets[0]?.createdAt ?? 0;

  const [animateParent] = useAutoAnimate();
  // demo 未读推导隔离：夹具恒视为未读（NEW! 验收项不读真实 localStorage）
  const [seenMs, setSeenMs] = useState<number>(() => getSeenTimestamp());
  const seen = demo ? 0 : seenMs;
  const newestRef = useRef<number>(0);
  const items = demo ? DEMO_CARDS : history.items;
  const newestMs = items.length > 0 ? new Date(items[0].timestamp).getTime() : 0;

  // 到达编排 + 打开即读：newest 变化（到达 → 震动+toast；首载 → 仅计时），
  // 4s 后全墙标记已读。依赖只挂 newestMs——loadMore 追加旧卡不触发。
  useEffect(() => {
    if (demo || items.length === 0) return;
    if (newestRef.current === 0) {
      newestRef.current = newestMs;
    } else if (newestMs > newestRef.current) {
      newestRef.current = newestMs;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduced && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(30);
      toast("新明信片寄回来了！");
    }
    const id = setTimeout(() => {
      markAllSeen(newestMs);
      setSeenMs(getSeenTimestamp());
    }, 4_000);
    return () => clearTimeout(id);
    // items.length 有意不入依赖：loadMore 追加旧卡不应重臂到达计时器（评审 #188）
  }, [demo, newestMs]);

  const onFeedback = (type: "like" | "dislike", card: PushContent): void => {
    void feedback.sendFeedback(type, card.messageId ?? "").then((ok) => {
      if (ok) toast(type === "like" ? "已记下：你喜欢这类货。" : "已记下：少送这类货。");
      else toast("反馈没送到（网络/权限）");
    });
  };
  const onPin = (card: PushContent): void => {
    if (demo) return; // 演示通道不写真实 CP
    void feedback.boostTopic(card.matchedTopics?.[0] ?? "").then((ok) => {
      if (ok) toast(`话题「${card.matchedTopics?.[0]}」顶到最前。`);
      else toast("置顶没送到");
    });
  };

  return (
    <div className="sb mx-auto max-w-3xl p-3">
      <header className="mb-3 flex items-baseline justify-between">
        <h1 className="font-ps2p text-xs text-[var(--hi)]">WALL · 明信片墙</h1>
        <span className="font-vt323 text-[20px] text-[var(--curb)]">
          {demo ? "DEMO FEED · " : ""}{demo ? items.length : history.total} 张
        </span>
      </header>
      {!demo && history.error && (
        <div className="mb-3 border-2 border-[var(--bad)] bg-[var(--panel)] p-3 text-[13px] text-[var(--bad)]">
          取件失败：{history.error}（可能未登录或网络中断）
        </div>
      )}
      <div className="grid gap-5 sm:grid-cols-2" ref={animateParent}>
        {items.map((card) => (
          <MailCard
            key={`${card.timestamp}|${card.message}`}
            card={card}
            adoptedAt={adoptedAt}
            seenMs={seen}
            onFeedback={onFeedback}
            onPin={onPin}
            pending={feedback.pending || demo}
          />
        ))}
      </div>
      {!demo && history.hasMore && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={history.loadMore}
            disabled={history.isLoadingMore}
            className="border-2 border-[var(--curb)] bg-[var(--panel)] px-4 py-2 text-[13px] text-[var(--paper)]"
          >
            {history.isLoadingMore ? "取件中……" : "再取一批"}
          </button>
        </div>
      )}
      {items.length === 0 && !history.isLoading && (
        <p className="py-16 text-center text-[14px] text-[var(--curb)]">
          墙上还空着。猫第一次游荡回来，这里就会有第一张明信片。
        </p>
      )}
    </div>
  );
}

/** useSearchParams 需 Suspense 边界（静态预渲染约束）。 */
export default function WallPage() {
  return (
    <Suspense>
      <WallInner />
    </Suspense>
  );
}
