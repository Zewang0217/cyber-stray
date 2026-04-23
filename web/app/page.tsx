"use client";

import { motion } from "framer-motion";
import { useAgentState } from "@/hooks/useAgentState";
import { CircularGauge } from "@/components/dashboard/CircularGauge";
import { MoodBadge } from "@/components/dashboard/MoodBadge";
import { StatCard } from "@/components/dashboard/StatCard";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { PulseBorder } from "@/components/effects/PulseBorder";

/**
 * Dashboard 首页
 * Agent 状态总览与核心指标展示
 */
export default function DashboardPage(): React.ReactElement {
  const { state, isLoading, error } = useAgentState();


  const isBored = state ? state.boredom >= 80 : false;


  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <motion.div
          className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        />
      </div>
    );
  }

  if (error || !state) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-danger font-mono mb-2">ERROR: {error ?? "State unavailable"}</p>
          <p className="text-subtext text-sm">请确认 Agent 已启动并生成了 data/state.json</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {isBored && <PulseBorder />}

      {/* Header */}
      <div className="flex items-center justify-between mb-10">
        <div>
          <motion.h1
            className="font-heading text-3xl font-bold text-text"
            style={{ letterSpacing: "-0.04em" }}
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
          >
            仪表盘
          </motion.h1>
          <p className="text-subtext mt-1">实时监控 Agent 状态与活动</p>
        </div>
        <ThemeToggle />
      </div>
      {/* 状态卡片区 */}
      <motion.div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 25, delay: 0.1 }}
      >
        <StatCard
          label="总狩猎次数"
          value={state.totalHunts}
          color="var(--color-accent)"
        />
        <StatCard
          label="总推送次数"
          value={state.totalPushes}
          color="var(--color-accent-blue)"
        />
        <StatCard
          label="连续失败"
          value={state.consecutiveFailures}
          color="var(--color-danger)"
        />
        <StatCard
          label="固执程度"
          value={state.stubbornness}
          unit="%"
          color="var(--color-warning)"
        />
      </motion.div>
      {/* 主仪表盘 */}
      <motion.div
        className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 25, delay: 0.2 }}
      >
        {/* 状态仪表盘 */}
        <div className="lg:col-span-2 p-6 rounded-2xl bg-mantle/60 border border-surface backdrop-blur-sm">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-heading text-lg font-bold text-text">Agent 状态</h2>
            <MoodBadge mood={state.mood} />
          </div>
          <div className="flex items-center justify-around py-4">
            <CircularGauge
              value={state.boredom}
              label="无聊值"
              color="var(--color-warning)"
              size={140}
              strokeWidth={10}
            />
            <CircularGauge
              value={state.energy}
              label="精力值"
              color="var(--color-success)"
              size={140}
              strokeWidth={10}
            />
            <CircularGauge
              value={state.temper}
              label="脾气值"
              color="var(--color-danger)"
              size={140}
              strokeWidth={10}
            />
          </div>
          {/* 上次行动 */}
          <div className="mt-6 pt-4 border-t border-surface">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-subtext">上次行动: </span>
                <span className="font-mono text-text">
                  {state.lastAction ?? "无"}
                </span>
              </div>
              <div>
                <span className="text-subtext">上次狩猎: </span>
                <span className="font-mono text-text">
                  {state.lastHunt
                    ? new Date(state.lastHunt).toLocaleString("zh-CN")
                    : "从未"}
                </span>
              </div>
              <div>
                <span className="text-subtext">上次心跳: </span>
                <span className="font-mono text-text">
                  {new Date(state.lastHeartbeat).toLocaleString("zh-CN")}
                </span>
              </div>
              <div>
                <span className="text-subtext">上次休息: </span>
                <span className="font-mono text-text">
                  {state.lastRest
                    ? new Date(state.lastRest).toLocaleString("zh-CN")
                    : "从未"}
                </span>
              </div>
            </div>
          </div>
        </div>
        {/* 快捷信息面板 */}
        <div className="p-6 rounded-2xl bg-mantle/60 border border-surface backdrop-blur-sm">
          <h2 className="font-heading text-lg font-bold text-text mb-4">
            记忆碎片
          </h2>
          <div className="space-y-4">
            <div>
              <p className="text-xs text-subtext uppercase tracking-wider mb-2">
                最近话题
              </p>
              <div className="flex flex-wrap gap-2">
                {state.recentTopics.length > 0 ? (
                  state.recentTopics.map((topic) => (
                    <span
                      key={topic}
                      className="px-2 py-1 rounded-md bg-surface/50 text-xs font-mono text-text"
                    >
                      {topic}
                    </span>
                  ))
                ) : (
                  <span className="text-subtext text-sm">暂无话题记录</span>
                )}
              </div>
            </div>
            <div>
              <p className="text-xs text-subtext uppercase tracking-wider mb-2">
                用户喜好
              </p>
              <div className="flex flex-wrap gap-2">
                {state.userLikes.length > 0 ? (
                  state.userLikes.map((like) => (
                    <span
                      key={like}
                      className="px-2 py-1 rounded-md bg-accent/10 text-xs font-mono text-accent"
                    >
                      {like}
                    </span>
                  ))
                ) : (
                  <span className="text-subtext text-sm">暂无喜好记录</span>
                )}
              </div>
            </div>
            <div>
              <p className="text-xs text-subtext uppercase tracking-wider mb-2">
                用户厌恶
              </p>
              <div className="flex flex-wrap gap-2">
                {state.userDislikes.length > 0 ? (
                  state.userDislikes.map((dislike) => (
                    <span
                      key={dislike}
                      className="px-2 py-1 rounded-md bg-danger/10 text-xs font-mono text-danger"
                    >
                      {dislike}
                    </span>
                  ))
                ) : (
                  <span className="text-subtext text-sm">暂无厌恶记录</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
