"use client";

import { motion } from "framer-motion";
import { useHistory } from "@/hooks/useHistory";
import { FeedCard } from "@/components/ui/FeedCard";

/**
 * 历史推送页面
 * 瀑布流展示所有推送内容
 */
export default function HistoryPage(): React.ReactElement {
  const { items, isLoading, error } = useHistory();

  if (isLoading) {
    return (
      <div className="spacing-lg flex items-center justify-center min-h-screen">
        <motion.div
          className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="spacing-lg flex items-center justify-center min-h-screen">
        <p className="text-danger font-mono">ERROR: {error}</p>
      </div>
    );
  }

  return (
    <div className="spacing-lg max-w-6xl mx-auto">
      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        <h1
          className="font-heading text-hero font-bold text-text"
          style={{ letterSpacing: "-0.04em" }}
        >
          历史推送
        </h1>
        <p className="text-body text-subtext mt-1">
          共 {items.length} 条推送记录
        </p>
      </motion.div>

      {items.length === 0 ? (
        <motion.div
          className="flex flex-col items-center justify-center py-20 text-subtext"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <p className="text-heading mb-2">暂无推送记录</p>
          <p className="text-small">Agent 还在游荡中，发现有趣内容后会自动推送...</p>
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
