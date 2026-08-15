"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Pet } from "@/hooks/usePets";

/** 默认初始兴趣（与服务端 DEFAULT_ADOPTION_INTERESTS 一致；用户可改） */
const DEFAULT_INTERESTS = ["科技", "AI", "互联网"];

/** 感兴趣的可选补充（起名后选兴趣用） */
const SUGGESTED_INTERESTS = [
  "科技", "AI", "互联网", "编程", "开源", "硬件", "游戏", "音乐",
  "电影", "设计", "心理学", "哲学", "经济学", "天文", "生物", "历史",
];

interface AdoptionFlowProps {
  adopting: boolean;
  onAdopt: (input: { name: string; interests?: string[] }) => Promise<Pet | null>;
}

/**
 * 领养流程（S7）：起名 → 选初始兴趣（默认给 + 可改） → 领养。
 * 领养成功后 onAdopt 返回宠物，父组件切换到自我介绍。
 */
export function AdoptionFlow({ adopting, onAdopt }: AdoptionFlowProps): React.ReactElement {
  const [step, setStep] = useState<"name" | "interests">("name");
  const [name, setName] = useState("");
  const [interests, setInterests] = useState<string[]>(DEFAULT_INTERESTS);
  const [error, setError] = useState<string | null>(null);

  const toggleInterest = (topic: string) => {
    setInterests((prev) =>
      prev.includes(topic) ? prev.filter((t) => t !== topic) : [...prev, topic],
    );
  };

  const submitName = () => {
    if (name.trim().length === 0 || name.length > 32) {
      setError("名字 1-32 个字符");
      return;
    }
    setError(null);
    setStep("interests");
  };

  const submitAdopt = async () => {
    if (interests.length === 0) {
      setError("至少选一个兴趣（也可以保留默认）");
      return;
    }
    setError(null);
    const pet = await onAdopt({ name: name.trim(), interests });
    if (!pet) {
      setError("领养失败，请重试");
    }
    // 成功时父组件切到自我介绍（本组件卸载）
  };

  return (
    <div className="spacing-lg flex items-center justify-center min-h-screen">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <AnimatePresence mode="wait">
          {step === "name" ? (
            <motion.div
              key="name"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="glass-card p-8 rounded-2xl"
            >
              <p className="text-xs text-subtext uppercase tracking-wider mb-2">
                Adoption · 领养
              </p>
              <h2 className="text-2xl font-bold text-text mb-4">
                给你的赛博宠物起个名字
              </h2>
              <p className="text-small text-subtext mb-6">
                它会带着自己的好奇心开始游荡互联网，把有意思的东西带回来给你。
              </p>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitName()}
                placeholder="比如：小溜"
                maxLength={32}
                className="w-full px-4 py-3 rounded-lg bg-surface border border-border
                  text-text placeholder:text-subtext focus:outline-none
                  focus:ring-2 focus:ring-primary/50 mb-4 font-mono"
              />
              {error && <p className="text-danger text-small mb-3">{error}</p>}
              <button
                onClick={submitName}
                className="w-full py-3 rounded-lg bg-primary text-white font-medium
                  hover:opacity-90 transition-opacity disabled:opacity-50"
                disabled={name.trim().length === 0}
              >
                下一步
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="interests"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="glass-card p-8 rounded-2xl"
            >
              <p className="text-xs text-subtext uppercase tracking-wider mb-2">
                Interests · 初始兴趣
              </p>
              <h2 className="text-2xl font-bold text-text mb-2">
                {name} 一开始对什么感兴趣？
              </h2>
              <p className="text-small text-subtext mb-6">
                已经帮你选了默认兴趣，点掉不想要的、加上想要的——
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
                      className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors
                        ${active
                          ? "bg-primary text-white"
                          : "bg-surface/50 text-subtext hover:text-text border border-border"}`}
                    >
                      {topic}
                    </button>
                  );
                })}
              </div>
              {error && <p className="text-danger text-small mb-3">{error}</p>}
              <div className="flex gap-3">
                <button
                  onClick={() => setStep("name")}
                  className="flex-1 py-3 rounded-lg border border-border text-subtext
                    hover:text-text transition-colors"
                >
                  返回改名
                </button>
                <button
                  onClick={() => void submitAdopt()}
                  disabled={adopting || interests.length === 0}
                  className="flex-1 py-3 rounded-lg bg-primary text-white font-medium
                    hover:opacity-90 transition-opacity disabled:opacity-50"
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
