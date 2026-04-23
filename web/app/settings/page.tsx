"use client";

import { motion } from "framer-motion";

/**
 * 设置页面
 * 只读展示当前配置，提示修改需编辑后端 .env
 */
export default function SettingsPage(): React.ReactElement {
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        <h1
          className="font-heading text-3xl font-bold text-text"
          style={{ letterSpacing: "-0.04em" }}
        >
          设置
        </h1>
        <p className="text-subtext mt-1">
          查看当前 Agent 配置（修改需编辑后端 .env 文件）
        </p>
      </motion.div>

      <motion.div
        className="grid grid-cols-1 lg:grid-cols-2 gap-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 25, delay: 0.1 }}
      >
        {/* 心跳配置 */}
        <div className="p-6 rounded-2xl bg-mantle/60 border border-surface backdrop-blur-sm">
          <h2 className="font-heading text-lg font-bold text-text mb-4">
            心跳与状态
          </h2>
          <div className="space-y-4 font-mono text-sm">
            <div className="flex justify-between">
              <span className="text-subtext">心跳间隔</span>
              <span className="text-text">5 分钟</span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtext">无聊增长速率</span>
              <span className="text-text">+5 / 心跳</span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtext">精力恢复速率</span>
              <span className="text-text">+2 / 心跳</span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtext">无聊阈值</span>
              <span className="text-text">50</span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtext">精力阈值</span>
              <span className="text-text">20</span>
            </div>
          </div>
        </div>

        {/* LLM 配置 */}
        <div className="p-6 rounded-2xl bg-mantle/60 border border-surface backdrop-blur-sm">
          <h2 className="font-heading text-lg font-bold text-text mb-4">
            LLM 配置
          </h2>
          <div className="space-y-4 font-mono text-sm">
            <div className="flex justify-between">
              <span className="text-subtext">模型</span>
              <span className="text-text">deepseek-chat</span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtext">Temperature</span>
              <span className="text-text">0.8</span>
            </div>
          </div>
        </div>

        {/* 搜索配置 */}
        <div className="p-6 rounded-2xl bg-mantle/60 border border-surface backdrop-blur-sm">
          <h2 className="font-heading text-lg font-bold text-text mb-4">
            搜索配置
          </h2>
          <div className="space-y-4 font-mono text-sm">
            <div className="flex justify-between">
              <span className="text-subtext">最大结果数</span>
              <span className="text-text">10</span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtext">搜索 API</span>
              <span className="text-text">Tavily</span>
            </div>
          </div>
        </div>

        {/* 推送配置 */}
        <div className="p-6 rounded-2xl bg-mantle/60 border border-surface backdrop-blur-sm">
          <h2 className="font-heading text-lg font-bold text-text mb-4">
            推送渠道
          </h2>
          <div className="space-y-4 font-mono text-sm">
            <div className="flex justify-between items-center">
              <span className="text-subtext">飞书 Webhook</span>
              <span className="text-success text-xs">已配置</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-subtext">Telegram Bot</span>
              <span className="text-subtext text-xs">未配置</span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* 提示 */}
      <motion.div
        className="mt-6 p-4 rounded-xl bg-warning/10 border border-warning/20"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        <p className="text-sm text-warning">
          提示：以上配置仅作展示。如需修改，请编辑项目根目录下的 .env 文件并重启 Agent。
        </p>
      </motion.div>
    </div>
  );
}
