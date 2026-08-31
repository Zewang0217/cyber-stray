"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import { useHistory } from "@/hooks/useHistory";
import { useTenantEvents } from "@/hooks/useTenantEvents";
import { FeedCard } from "@/components/ui/FeedCard";
import { PetSprite } from "@/components/dashboard/PetSprite";
import { PageHeader } from "@/components/ui/PageHeader";
import { staggerContainer } from "@/components/ui/motion";

/**
 * 历史推送页(采集者笔记条目册)
 * 瀑布流展示所有推送内容(S8:SSE 事件触发实时刷新)
 */
export default function HistoryPage(): React.ReactElement {
  const { connected: realtimeConnected, refreshSignal } = useTenantEvents();
  const { items, total, isLoading, isLoadingMore, hasMore, error, loadMore } = useHistory({
    refreshSignal,
    realtimeConnected,
  });

  // #123 分页：滚动接近底部 → 加载更多
  useEffect(() => {
    const onScroll = () => {
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 400) {
        loadMore();
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [loadMore]);

  if (isLoading) {
    return (
      <div className="spacing-lg flex flex-col items-center justify-center min-h-screen gap-4">
        <PetSprite size={120} state="walk" />
        <p className="field-note text-sm text-subtext">正在翻阅采集笔记…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="spacing-lg flex items-center justify-center min-h-screen">
        <div className="text-center paper-card p-8 max-w-md">
          <p className="mono-reading text-sm text-text mb-2">{error}</p>
          <p className="field-note text-sm text-subtext">采集记录读取失败,请稍后重试</p>
        </div>
      </div>
    );
  }

  return (
    <div className="spacing-lg max-w-6xl mx-auto">
      <PageHeader
        kicker="Annotationes"
        title="历史推送"
        size="hero"
        subtitle={`共 ${total} 条采集记录`}
      />

      {items.length === 0 ? (
        <motion.div
          className="flex flex-col items-center justify-center py-20 text-subtext gap-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <p className="font-heading text-heading mb-2">暂无采集记录</p>
          <p className="field-note text-base">它还在游荡,发现有趣的东西会带回来…</p>
        </motion.div>
      ) : (
        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
          initial="hidden"
          animate="visible"
          variants={staggerContainer}
        >
          {items.map((item) => (
            <FeedCard key={item.timestamp + item.title} item={item} />
          ))}
        </motion.div>
      )}
      {/* #123 分页：滚动加载状态 */}
      {items.length > 0 && (
        <div className="flex justify-center py-8">
          {isLoadingMore ? (
            <span className="field-note text-sm text-subtext animate-pulse">正在翻阅更多…</span>
          ) : hasMore ? (
            <span className="field-note text-sm text-subtext">继续滚动加载更多</span>
          ) : (
            <span className="field-note text-sm text-subtext">—— 已翻阅全部 ——</span>
          )}
        </div>
      )}
    </div>
  );
}
