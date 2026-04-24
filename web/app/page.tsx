"use client";

import { useState, useEffect } from "react";
import {
    motion,
    useScroll,
    useTransform,
    AnimatePresence,
} from "framer-motion";
import { useAgentState } from "@/hooks/useAgentState";
import { CircularGauge } from "@/components/dashboard/CircularGauge";
import { MoodBadge } from "@/components/dashboard/MoodBadge";
import { StatCard } from "@/components/dashboard/StatCard";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { PulseBorder } from "@/components/effects/PulseBorder";
import { HeroStage } from "@/components/effects/HeroStage";

/**
 * Dashboard 首页
 * Agent 状态总览与核心指标展示
 * 包含 parallax 滚动效果和 staggerChildren 动画编排
 */
export default function DashboardPage(): React.ReactElement {
    // 1. 默认不显示，避免水合闪烁
    const [showHeroStage, setShowHeroStage] = useState(false);
    // 2. 增加一个检测状态
    const [isCheckingIntro, setIsCheckingIntro] = useState(true);

    const { state, isLoading, error } = useAgentState();
    const { scrollY } = useScroll();
    const heroY = useTransform(scrollY, [0, 300], [0, -50]);
    const heroOpacity = useTransform(scrollY, [0, 200], [1, 0.3]);

    const isBored = state ? state.boredom >= 80 : false;

    // 3. 在客户端挂载时检查 sessionStorage
    useEffect(() => {
        const played = sessionStorage.getItem("cyber_intro_played");
        if (!played) {
            setShowHeroStage(true); // 只有没播放过，才开启
        }
        setIsCheckingIntro(false); // 检查完毕
    }, []);

    // 4. 如果还在检查中，抛出一个纯黑屏防止底部的 Dashboard 提前暴露
    if (isCheckingIntro) {
        return <div className="fixed inset-0 bg-[#09090b] z-[9999]" />;
    }

    // 5. 修复加载状态的渲染逻辑
    if (isLoading) {
        return (
            <>
                <AnimatePresence>
                    {showHeroStage && (
                        <HeroStage onEnter={() => setShowHeroStage(false)} />
                    )}
                </AnimatePresence>
                <div className="spacing-lg flex items-center justify-center min-h-screen">
                    {/* ... 原有 Loading 动画 ... */}
                </div>
            </>
        );
    }

    if (error || !state) {
        return (
            <>
                <AnimatePresence>
                    {showHeroStage && <HeroStage />}
                </AnimatePresence>
                <div className="spacing-lg flex items-center justify-center min-h-screen">
                    <div className="text-center">
                        <p className="text-danger font-mono mb-2">
                            ERROR: {error ?? "State unavailable"}
                        </p>
                        <p className="text-subtext text-small">
                            请确认 Agent 已启动并生成了 data/state.json
                        </p>
                    </div>
                </div>
            </>
        );
    }

    return (
        <>
            <AnimatePresence>
                {showHeroStage && (
                    <motion.div
                        className="fixed inset-0 z-[100]"
                        initial={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.5 }}
                    >
                        <HeroStage onEnter={() => setShowHeroStage(false)} />
                    </motion.div>
                )}
            </AnimatePresence>
            <div className="spacing-lg max-w-6xl mx-auto">
                {isBored && <PulseBorder />}

                {/* Header with Parallax */}
                <motion.div
                    className="flex items-center justify-between mb-10"
                    style={{ y: heroY, opacity: heroOpacity }}
                >
                    <div>
                        <motion.h1
                            className="font-heading text-hero font-bold text-text"
                            style={{ letterSpacing: "-0.04em" }}
                            initial={{ opacity: 0, y: -20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{
                                type: "spring",
                                stiffness: 400,
                                damping: 25,
                            }}
                        >
                            仪表盘
                        </motion.h1>
                        <p className="text-body text-subtext mt-1">
                            实时监控 Agent 状态与活动
                        </p>
                    </div>
                    <ThemeToggle />
                </motion.div>
                {/* 状态卡片区 - Stagger Animation */}
                <motion.div
                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8"
                    initial="hidden"
                    animate="visible"
                    variants={{
                        hidden: { opacity: 0 },
                        visible: {
                            opacity: 1,
                            transition: {
                                staggerChildren: 0.12,
                                delayChildren: 0.1,
                            },
                        },
                    }}
                >
                    <StatCard
                        label="总游荡次数"
                        value={state.totalWanders ?? 0}
                        color="var(--color-accent)"
                    />
                    <StatCard
                        label="总游荡步数"
                        value={state.totalSteps ?? 0}
                        color="var(--color-accent-blue)"
                    />
                    <StatCard
                        label="总推送次数"
                        value={state.totalPushes}
                        color="var(--color-success)"
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
                    transition={{
                        type: "spring",
                        stiffness: 400,
                        damping: 25,
                        delay: 0.2,
                    }}
                >
                    {/* 状态仪表盘 */}
                    <div className="lg:col-span-2 p-6 rounded-2xl backdrop-blur-xl bg-mantle/[0.05] border border-white/10">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="font-heading text-heading font-bold text-text">
                                Agent 状态
                            </h2>
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
                                    <span className="text-subtext">
                                        上次行动:{" "}
                                    </span>
                                    <span className="font-mono text-text">
                                        {state.lastAction ?? "无"}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-subtext">
                                        上次游荡:{" "}
                                    </span>
                                    <span className="font-mono text-text">
                                        {state.lastWander
                                            ? new Date(
                                                  state.lastWander,
                                              ).toLocaleString("zh-CN")
                                            : "从未"}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-subtext">
                                        上次心跳:{" "}
                                    </span>
                                    <span className="font-mono text-text">
                                        {new Date(
                                            state.lastHeartbeat,
                                        ).toLocaleString("zh-CN")}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-subtext">
                                        上次休息:{" "}
                                    </span>
                                    <span className="font-mono text-text">
                                        {state.lastRest
                                            ? new Date(
                                                  state.lastRest,
                                              ).toLocaleString("zh-CN")
                                            : "从未"}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                    {/* 快捷信息面板 */}
                    <div className="p-6 rounded-2xl backdrop-blur-xl bg-mantle/[0.05] border border-white/10">
                        <h2 className="font-heading text-heading font-bold text-text mb-4">
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
                                        <span className="text-subtext text-sm">
                                            暂无话题记录
                                        </span>
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
                                        <span className="text-subtext text-sm">
                                            暂无喜好记录
                                        </span>
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
                                        <span className="text-subtext text-sm">
                                            暂无厌恶记录
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div>
                                <p className="text-xs text-subtext uppercase tracking-wider mb-2">
                                    Agent 兴趣
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {(state.agentInterests ?? []).length > 0 ? (
                                        (state.agentInterests ?? []).map((interest: string) => (
                                            <span
                                                key={interest}
                                                className="px-2 py-1 rounded-md bg-success/10 text-xs font-mono text-success"
                                            >
                                                {interest}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-subtext text-sm">
                                            暂无兴趣记录
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>
                {/* 游荡历史 */}
                <motion.div
                    className="p-6 rounded-2xl backdrop-blur-xl bg-mantle/[0.05] border border-white/10"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                >
                    <h2 className="font-heading text-heading font-bold text-text mb-4">
                        最近游荡
                    </h2>
                    <div className="space-y-3">
                        {(state.wanderHistory ?? []).length > 0 ? (
                            (state.wanderHistory ?? [])
                                .slice(-5)
                                .reverse()
                                .map((step) => (
                                    <div
                                        key={step.timestamp}
                                        className="flex items-center gap-3 text-sm"
                                    >
                                        <span className="text-subtext shrink-0">
                                            {new Date(
                                                step.timestamp,
                                            ).toLocaleTimeString("zh-CN")}
                                        </span>
                                        <span className="font-mono text-accent shrink-0">
                                            {step.tool}
                                        </span>
                                        {step.url && (
                                            <span className="text-xs text-subtext truncate max-w-[200px]">
                                                {step.url}
                                            </span>
                                        )}
                                        {step.thought && (
                                            <span className="text-xs text-text opacity-70 truncate">
                                                {step.thought.slice(0, 50)}
                                            </span>
                                        )}
                                    </div>
                                ))
                        ) : (
                            <span className="text-subtext text-sm">
                                暂无游荡记录
                            </span>
                        )}
                    </div>
                </motion.div>
            </div>
        </>
    );
}
