"use client";

import { motion } from "framer-motion";
import { useHistory } from "@/hooks/useHistory";
import { useTenantEvents } from "@/hooks/useTenantEvents";
import { FeedCard } from "@/components/ui/FeedCard";
import { PetSprite } from "@/components/dashboard/PetSprite";

/**
 * 历史推送页(采集者笔记条目册)
 * 瀑布流展示所有推送内容(S8:SSE 事件触发实时刷新)
 */
export default function HistoryPage(): React.ReactElement {
  const { connected: realtimeConnected, refreshSignal } = useTenantEvents();
  const { items, isLoading, error } = useHistory({
    refreshSignal,
    realtimeConnected,
  });

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
      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
      >
        <p className="field-note text-sm text-subtext mb-1">Annotationes</p>
        <h1
          className="font-heading text-hero font-semibold text-text"
          style={{ letterSpacing: "-0.01em" }}
        >
          历史推送
        </h1>
        <p className="text-body text-subtext mt-1">共 {items.length} 条采集记录</p>
      </motion.div>
      <div className="engraving-rule mb-8" />

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
          variants={{
            hidden: { opacity: 0 },
            visible: {
              opacity: 1,
              transition: {
                staggerChildren: 0.08,
              },
            },
          }}
        >
          {items.map((item) => (
            <FeedCard key={item.timestamp + item.title} item={item} />
          ))}
        </motion.div>
      )}
    </div>
  );
}
