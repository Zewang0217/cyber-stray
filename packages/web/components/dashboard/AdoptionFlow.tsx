"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  listPersonalities,
  DEFAULT_PERSONALITY,
  type PersonalityId,
} from "@cyber-stray/shared";
import type { Pet } from "@/hooks/usePets";

/** 默认初始兴趣（与服务端 DEFAULT_ADOPTION_INTERESTS 一致；用户可改） */
const DEFAULT_INTERESTS = ["科技", "AI", "互联网"];

/** 感兴趣的可选补充（起名后选兴趣用） */
const SUGGESTED_INTERESTS = [
  "科技", "AI", "互联网", "编程", "开源", "硬件", "游戏", "音乐",
  "电影", "设计", "心理学", "哲学", "经济学", "天文", "生物", "历史",
];

/** 全部注册性格（注册表单一真相源；认领页展示优劣说明） */
const PERSONALITIES = listPersonalities();

interface AdoptionFlowProps {
  adopting: boolean;
  onAdopt: (input: {
    name: string;
    interests?: string[];
    personality?: PersonalityId;
  }) => Promise<Pet | null>;
}

/**
 * 领养流程（S7 + #90）：起名 → 选性格（优劣说明） → 选初始兴趣（默认给 + 可改） → 领养。
 * 图鉴世界:图鉴登记新标本。领养成功后 onAdopt 返回宠物,父组件切换到自我介绍。
 */
export function AdoptionFlow({ adopting, onAdopt }: AdoptionFlowProps): React.ReactElement {
  const [step, setStep] = useState<"name" | "personality" | "interests">("name");
  const [name, setName] = useState("");
  const [personality, setPersonality] = useState<PersonalityId>(DEFAULT_PERSONALITY);
  const [interests, setInterests] = useState<string[]>(DEFAULT_INTERESTS);
  const [error, setError] = useState<string | null>(null);

  const toggleInterest = (topic: string) => {
    setInterests((prev) =>
      prev.includes(topic) ? prev.filter((t) => t !== topic) : [...prev, topic],
    );
  };

  const submitName = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || name.length > 32) {
      setError("名字需要 1-32 个字符");
      return;
    }
    setError(null);
    setStep("personality");
  };

  const submitPersonality = () => {
    setError(null);
    setStep("interests");
  };

  const submitAdopt = async () => {
    if (interests.length === 0) {
      setError("至少选一个兴趣");
      return;
    }
    const pet = await onAdopt({ name: name.trim(), interests, personality });
    if (!pet) setError("领养失败,请重试");
  };

  const back = (target: "name" | "personality") => {
    setError(null);
    setStep(target);
  };

  return (
    <div className="spacing-lg flex items-center justify-center min-h-screen">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="w-full max-w-md"
      >
        <AnimatePresence mode="wait">
          {step === "name" ? (
            <motion.div
              key="name"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              className="paper-card p-8 rounded-sm"
            >
              <p className="field-note text-sm text-subtext mb-2">
                Adoption · 领养
              </p>
              <h2 className="font-heading text-2xl font-semibold text-text mb-4">
                给你的赛博宠物起个名字
              </h2>
              <p className="text-small text-subtext leading-relaxed mb-6">
                它会带着自己的好奇心开始游荡互联网,把有意思的东西带回来给你。
              </p>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitName()}
                placeholder="比如:小溜"
                maxLength={32}
                className="w-full px-4 py-3 rounded-sm bg-[var(--c-paper)] border border-[var(--c-engraving-fine)]
                  text-text placeholder:text-subtext focus:outline-none
                  focus:border-[var(--c-amber)] mb-4 font-heading text-body"
              />
              {error && <p className="field-note text-sm text-[var(--c-state-warn)] mb-3">{error}</p>}
              <button
                onClick={submitName}
                className="w-full py-3 rounded-sm bg-[var(--c-ink)] text-[var(--c-paper)] font-heading font-medium
                  hover:border-[var(--c-amber)] hover:shadow-[0_2px_0_0_var(--c-amber)] transition-all disabled:opacity-50"
                disabled={name.trim().length === 0}
              >
                下一步
              </button>
            </motion.div>
          ) : step === "personality" ? (
            <motion.div
              key="personality"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              className="paper-card p-8 rounded-sm"
            >
              <p className="field-note text-sm text-subtext mb-2">
                Personality · 性格
              </p>
              <h2 className="font-heading text-2xl font-semibold text-text mb-2">
                {name} 是什么性格?
              </h2>
              <p className="text-small text-subtext leading-relaxed mb-6">
                性格决定它的行为节奏与说话语气——好奇的它总在发现新东西,
                慵懒的它慢悠悠但偶尔冒出妙语。
              </p>
              <div className="space-y-3 mb-6">
                {PERSONALITIES.map((p) => {
                  const active = personality === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPersonality(p.id)}
                      className={`w-full text-left p-4 rounded-sm border transition-colors
                        ${active
                          ? "bg-[var(--c-paper)] border-[var(--c-amber)] shadow-[0_2px_0_0_var(--c-amber)]"
                          : "bg-[var(--c-paper)] border-[var(--c-engraving-fine)] hover:border-[var(--c-amber)]"}`}
                    >
                      <span className="flex items-center justify-between mb-1">
                        <span className="font-heading text-body text-text">
                          {p.name}
                          {active && (
                            <span className="ml-2 text-xs text-[var(--c-amber)]">✓ 已选</span>
                          )}
                        </span>
                      </span>
                      <span className="block text-small text-subtext leading-relaxed mb-2">
                        {p.description}
                      </span>
                      <span className="block text-xs text-subtext leading-relaxed">
                        <span className="text-[var(--c-faded-ink)]">优:</span> {p.strengths.join("、")}
                        <span className="mx-1 text-[var(--c-faded-ink)]">·</span>
                        <span className="text-[var(--c-faded-ink)]">劣:</span> {p.weaknesses.join("、")}
                      </span>
                    </button>
                  );
                })}
              </div>
              {error && <p className="field-note text-sm text-[var(--c-state-warn)] mb-3">{error}</p>}
              <div className="flex gap-3">
                <button
                  onClick={() => back("name")}
                  className="flex-1 py-3 rounded-sm border border-[var(--c-engraving-fine)] text-subtext
                    hover:text-text hover:border-[var(--c-amber)] transition-colors"
                >
                  返回改名
                </button>
                <button
                  onClick={submitPersonality}
                  className="flex-1 py-3 rounded-sm bg-[var(--c-ink)] text-[var(--c-paper)] font-heading font-medium
                    hover:shadow-[0_2px_0_0_var(--c-amber)] transition-all"
                >
                  下一步
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="interests"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              className="paper-card p-8 rounded-sm"
            >
              <p className="field-note text-sm text-subtext mb-2">
                Interests · 初始兴趣
              </p>
              <h2 className="font-heading text-2xl font-semibold text-text mb-2">
                {name} 一开始对什么感兴趣?
              </h2>
              <p className="text-small text-subtext leading-relaxed mb-6">
                已经帮你选了默认兴趣,点掉不想要的、加上想要的——
                之后它自己会进化出新的兴趣。
              </p>
              <div className="flex flex-wrap gap-2 mb-6">
                {SUGGESTED_INTERESTS.map((topic) => {
                  const active = interests.includes(topic);
                  return (
                    <button
                      key={topic}
                      autoFocus={topic === SUGGESTED_INTERESTS[0]}
                      onClick={() => toggleInterest(topic)}
                      className={`px-3 py-1.5 rounded-sm text-xs font-heading transition-colors
                        ${active
                          ? "bg-[var(--c-ink)] text-[var(--c-paper)] border border-[var(--c-ink)]"
                          : "bg-[var(--c-paper)] text-subtext hover:text-text border border-[var(--c-engraving-fine)]"}`}
                    >
                      {topic}
                    </button>
                  );
                })}
              </div>
              {error && <p className="field-note text-sm text-[var(--c-state-warn)] mb-3">{error}</p>}
              <div className="flex gap-3">
                <button
                  onClick={() => back("personality")}
                  className="flex-1 py-3 rounded-sm border border-[var(--c-engraving-fine)] text-subtext
                    hover:text-text hover:border-[var(--c-amber)] transition-colors"
                >
                  返回改性格
                </button>
                <button
                  onClick={() => void submitAdopt()}
                  disabled={adopting || interests.length === 0}
                  className="flex-1 py-3 rounded-sm bg-[var(--c-ink)] text-[var(--c-paper)] font-heading font-medium
                    hover:shadow-[0_2px_0_0_var(--c-amber)] transition-all disabled:opacity-50"
                >
                  {adopting ? "领养中…" : `领养 ${name}`}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
