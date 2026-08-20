"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { getPersonality } from "@cyber-stray/shared";
import { useAgentState } from "@/hooks/useAgentState";
import { useTenantEvents } from "@/hooks/useTenantEvents";
import { useInterestGraph } from "@/hooks/useInterestGraph";
import { usePets, type Pet } from "@/hooks/usePets";
import { AdoptionFlow } from "@/components/dashboard/AdoptionFlow";
import { PetIntro } from "@/components/dashboard/PetIntro";
import { PetSprite } from "@/components/dashboard/PetSprite";
import { FieldNote } from "@/components/dashboard/FieldNote";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

/**
 * 图鉴首页:维多利亚自然博物图鉴
 * 废弃仪表盘堆卡片,改为图鉴页面布局:
 * - 顶部:图鉴标题 + 主题切换
 * - 主区:PetSprite 活着的插画(中心)+ 名字 + 采集笔记
 * - 状态读数行:采集者笔记里的数字(等宽 + 手写注解)
 * - 推送流:采集者笔记新贴发现(stagger reveal)
 * - 兴趣图谱:采集品类整理(自改节点带琥珀呼吸光)
 * - 游荡足迹:最近观察记录
 */
export default function DashboardPage(): React.ReactElement {
    const [isCheckingIntro, setIsCheckingIntro] = useState(true);
    useEffect(() => {
      setIsCheckingIntro(false);
    }, []);
    const [introPet, setIntroPet] = useState<Pet | null>(null);
    const [introInterests, setIntroInterests] = useState<string[]>([]);
    const [introRestored, setIntroRestored] = useState(false);
    const { refreshSignal, lastEvent } = useTenantEvents();
    const { pets, isLoaded: petsLoaded, error: petsError, adopt, adopting } = usePets();
    const { state, isLoading, error } = useAgentState({ refreshSignal });
    const {
        nodes: interestNodes,
        entropy,
        lastUpdated: interestLastUpdated,
    } = useInterestGraph({ refreshSignal });

    // 刷新后恢复未完成的自我介绍
    useEffect(() => {
      const pending = sessionStorage.getItem("cyber_pet_intro");
      if (pending && !introPet) {
        try {
          const { petId, interests } = JSON.parse(pending) as {
            petId: string;
            interests: string[];
          };
          const pet = pets.find((p) => p.id === petId);
          if (pet) {
            setIntroPet(pet);
            setIntroInterests(interests);
          }
        } catch {
          sessionStorage.removeItem("cyber_pet_intro");
        }
      }
      setIntroRestored(true);
    }, [pets, introPet]);

    // 检查中:纸色屏防止底部暴露
    if (isCheckingIntro || !introRestored) {
        return <div className="fixed inset-0 bg-base z-[9999]" />;
    }

    // 领养门:未领养 → 领养流程
    if (petsLoaded && !petsError && pets.length === 0 && !introPet) {
        return (
            <>
                <AdoptionFlow
                    adopting={adopting}
                    onAdopt={async (input) => {
                        const pet = await adopt(input);
                        if (pet) {
                            setIntroPet(pet);
                            setIntroInterests(input.interests ?? []);
                            sessionStorage.setItem(
                                "cyber_pet_intro",
                                JSON.stringify({
                                    petId: pet.id,
                                    interests: input.interests ?? [],
                                }),
                            );
                        }
                        return pet;
                    }}
                />
            </>
        );
    }

    // 自我介绍:领养后、首推前
    if (introPet) {
        return (
            <PetIntro
                pet={introPet}
                interests={introInterests}
                onDone={() => {
                    sessionStorage.removeItem("cyber_pet_intro");
                    setIntroPet(null);
                }}
            />
        );
    }

    // 加载态
    if (isLoading) {
        return (
            <div className="spacing-lg flex flex-col items-center justify-center min-h-screen gap-4">
                <PetSprite size={120} state="walk" />
                <p className="field-note text-sm text-subtext">
                    正在翻阅图鉴…
                </p>
            </div>
        );
    }

    // 错误态
    if (error) {
        return (
            <div className="spacing-lg flex items-center justify-center min-h-screen">
                <div className="text-center paper-card p-8 max-w-md">
                    <p className="mono-reading text-sm text-text mb-2">
                        {error}
                    </p>
                    <p className="field-note text-sm text-subtext">
                        数据读取失败,请稍后重试
                    </p>
                </div>
            </div>
        );
    }

    // 空态:尚未游荡
    if (!state) {
        return (
            <div className="spacing-lg flex flex-col items-center justify-center min-h-screen gap-6">
                <PetSprite size={180} mood="curious" />
                <div className="text-center">
                    <p className="font-heading text-heading text-text mb-2">
                        你的赛博宠物还没有开始游荡
                    </p>
                    <p className="field-note text-sm text-subtext">
                        首次游荡后这里会显示它的观察记录
                    </p>
                </div>
            </div>
        );
    }

    const isBored = state.boredom >= 80;

    return (
        <div className="spacing-lg max-w-6xl mx-auto">
            {/* 图鉴标题 + 主题切换 */}
            <motion.header
                className="flex items-center justify-between mb-8"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 28 }}
            >
                <div>
                    <p className="field-note text-sm text-subtext mb-1">
                        Tabula Principalis
                    </p>
                    <h1
                        className="font-heading text-hero font-semibold text-text"
                        style={{ letterSpacing: "-0.01em" }}
                    >
                        Cyber Stray
                    </h1>
                </div>
                <ThemeToggle />
            </motion.header>
            <div className="engraving-rule mb-8" />

            {/* 主区:会动的铜版画宠物 + 采集笔记 */}
            <motion.section
                className="paper-card p-8 mb-8"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.1 }}
            >
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                    {/* 左:会动的铜版画插画 */}
                    <div className="flex flex-col items-center gap-4">
                        <div className="relative">
                            {/* 生命色光晕(示能:它活着) */}
                            {isBored && (
                                <div
                                    className="absolute inset-0 rounded-full pointer-events-none"
                                    style={{
                                        boxShadow: "0 0 40px 8px var(--c-amber)",
                                        animation: "var(--animate-amber-breath)",
                                        opacity: 0.3,
                                    }}
                                />
                            )}
                            <PetSprite mood={state.mood} size={240} pattable event={lastEvent} />
                        </div>
                        <p className="field-note text-sm text-subtext italic">
                            实时观察中 · 拍拍它
                        </p>
                    </div>

                    {/* 右:采集笔记(手写拉丁名 + 状态) */}
                    <div className="space-y-4">
                        <div>
                            <p className="font-heading text-3xl font-semibold italic text-text leading-tight">
                                {pets[0]?.name ?? "Cyber Stray"}
                            </p>
                            <p className="field-note text-lg text-[var(--c-faded-ink)] mt-0.5">
                                {pets[0]
                                    ? `${getPersonality(pets[0].personality).name}性格的赛博街溜子`
                                    : "赛博街溜子"}
                            </p>
                        </div>
                        <div className="engraving-rule" />
                        <FieldNote label="上次行动" value={state.lastAction ?? "无"} mono />
                        <FieldNote
                            label="上次游荡"
                            value={
                                state.lastWander
                                    ? new Date(state.lastWander).toLocaleString("zh-CN")
                                    : "从未"
                            }
                            mono
                        />
                        <FieldNote
                            label="上次心跳"
                            value={new Date(state.lastHeartbeat).toLocaleString("zh-CN")}
                            mono
                        />
                        <FieldNote
                            label="上次休息"
                            value={
                                state.lastRest
                                    ? new Date(state.lastRest).toLocaleString("zh-CN")
                                    : "从未"
                            }
                            mono
                        />
                    </div>
                </div>
            </motion.section>

            {/* 状态读数行:采集者笔记里的数字 */}
            <motion.section
                className="mb-8"
                initial="hidden"
                animate="visible"
                variants={{
                    hidden: { opacity: 0 },
                    visible: {
                        opacity: 1,
                        transition: { staggerChildren: 0.12, delayChildren: 0.2 },
                    },
                }}
            >
                <p className="field-note text-xs text-subtext uppercase tracking-wider mb-3">
                    生理测量 · Status
                </p>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <FieldNote label="无聊值" value={`${state.boredom}`} suffix="/100" isReading />
                    <FieldNote label="精力值" value={`${state.energy}`} suffix="/100" isReading />
                    <FieldNote label="脾气值" value={`${state.temper}`} suffix="/100" isReading />
                    <FieldNote label="固执度" value={`${state.stubbornness}`} suffix="/100" isReading />
                    <FieldNote label="连续失败" value={`${state.consecutiveFailures}`} isReading />
                </div>
            </motion.section>

            {/* 统计:游荡次数/步数/推送(采集者记录) */}
            <motion.section
                className="paper-card p-6 mb-8"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.25 }}
            >
                <p className="field-note text-xs text-subtext uppercase tracking-wider mb-3">
                    观察统计 · Census
                </p>
                <div className="grid grid-cols-3 gap-4">
                    <FieldNote label="总游荡" value={`${state.totalWanders ?? 0}`} isReading large />
                    <FieldNote label="总步数" value={`${state.totalSteps ?? 0}`} isReading large />
                    <FieldNote label="总推送" value={`${state.totalPushes}`} isReading large />
                </div>
            </motion.section>

            {/* 兴趣图谱:采集品类整理(自改节点带琥珀呼吸光) */}
            <motion.section
                className="mb-8"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.3 }}
            >
                <div className="flex items-center justify-between mb-3">
                    <p className="field-note text-xs text-subtext uppercase tracking-wider">
                        兴趣分类 · Taxonomia
                    </p>
                    {interestLastUpdated && (
                        <p className="mono-reading text-xs text-subtext">
                            {new Date(interestLastUpdated).toLocaleString("zh-CN")}
                        </p>
                    )}
                </div>
                <div className="paper-card p-6">
                    {interestNodes.length > 0 ? (
                        <ul className="space-y-3">
                            {interestNodes.slice(0, 8).map((node) => (
                                <li
                                    key={node.id}
                                    className="flex items-center gap-3"
                                >
                                    <span
                                        className={
                                            node.source === "reflection"
                                                ? "w-1.5 h-1.5 rounded-full bg-[var(--c-amber)] animate-[var(--animate-amber-breath)]"
                                                : "w-1.5 h-1.5 rounded-full bg-[var(--c-faded-ink)]"
                                        }
                                    />
                                    <span className="font-heading text-sm text-text flex-1 truncate">
                                        {node.id}
                                    </span>
                                    <span className="mono-reading text-xs text-subtext">
                                        {(node.weight * 100).toFixed(1)}%
                                    </span>
                                    {node.source === "reflection" && (
                                        <span className="field-note text-xs text-[var(--c-amber)] italic">
                                            自改
                                        </span>
                                    )}
                                    {node.source === "feedback" && (
                                        <span className="field-note text-xs text-subtext italic">
                                            顶过
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="field-note text-sm text-subtext">
                            尚无采集记录
                        </p>
                    )}
                    {/* 熵值(采集者笔记注脚) */}
                    <div className="engraving-rule mt-4" />
                    <div className="flex justify-between items-center mt-3">
                        <p className="field-note text-xs text-subtext">
                            熵值 · Entropia
                        </p>
                        <p className="mono-reading text-sm text-text">
                            {entropy.toFixed(3)}
                        </p>
                    </div>
                </div>
            </motion.section>

            {/* 游荡足迹:最近观察记录 */}
            <motion.section
                className="paper-card p-6"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.35 }}
            >
                <p className="field-note text-xs text-subtext uppercase tracking-wider mb-3">
                    最近游荡 · Itinerarium
                </p>
                {(state.wanderHistory ?? []).length > 0 ? (
                    <ul className="space-y-2">
                        {(state.wanderHistory ?? [])
                            .slice(-5)
                            .reverse()
                            .map((step) => (
                                <li
                                    key={step.timestamp}
                                    className="flex items-baseline gap-3 text-sm"
                                >
                                    <span className="mono-reading text-xs text-subtext shrink-0">
                                        {new Date(step.timestamp).toLocaleTimeString("zh-CN")}
                                    </span>
                                    <span className="mono-reading text-xs text-text shrink-0">
                                        {step.tool}
                                    </span>
                                    {step.url && (
                                        <span className="field-note text-xs text-subtext truncate max-w-[200px]">
                                            {step.url}
                                        </span>
                                    )}
                                    {step.thought && (
                                        <span className="field-note text-xs text-subtext truncate">
                                            {step.thought.slice(0, 50)}
                                        </span>
                                    )}
                                </li>
                            ))}
                    </ul>
                ) : (
                    <p className="field-note text-sm text-subtext">
                        暂无游荡记录
                    </p>
                )}
            </motion.section>
        </div>
    );
}
