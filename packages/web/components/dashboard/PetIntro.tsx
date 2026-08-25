"use client";

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { TypewriterText } from "@/components/ui/TypewriterText";
import { PetSprite } from "@/components/dashboard/PetSprite";
import type { Pet } from "@/hooks/usePets";

interface PetIntroProps {
  pet: Pet;
  interests: string[];
  /** 自我介绍展示完（用户点继续）后回调，进入正常应用 */
  onDone: () => void;
}

/**
 * 宠物自我介绍（S7）：领养后、首推前展示。
 * 图鉴世界:新标本在图鉴页上亲自开口,手写旁注逐行浮现(打字机保留)。
 * 已完成的行渲染为静态文本,只对当前行打字——避免 TypewriterText 的
 * effect 依赖(含内联 onComplete)在父组件重渲染时整段重来。
 * sessionStorage 标记使刷新后仍可看到,直到用户点"带它回家"。
 */
export function PetIntro({ pet, interests, onDone }: PetIntroProps): React.ReactElement {
  const [lineIndex, setLineIndex] = useState(0);

  const introLines = [
    `你好，我是 ${pet.name}。`,
    `我对 ${interests.slice(0, 3).join("、")} 这些东西很好奇。`,
    "从现在起我会在互联网上到处溜达——读文章、追链接、发现新鲜事。",
    "看到你可能会感兴趣的东西，我会带回来给你。",
    "我的兴趣会变，可能会变得跟你以为的完全不一样。这是正常的。",
  ];

  // 稳定引用：TypewriterText 的 effect 依赖 onComplete，内联箭头会触发重打
  const advanceLine = useCallback(() => {
    setLineIndex((idx) => Math.min(idx + 1, introLines.length - 1));
  }, [introLines.length]);

  const done = lineIndex >= introLines.length - 1;

  return (
    <div className="spacing-lg flex items-center justify-center min-h-screen">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="w-full max-w-lg paper-card p-10 rounded-sm"
      >
        {/* 新标本亲自露面:活着的插画 */}
        <div className="flex justify-center mb-4">
          <PetSprite size={160} state="welcome" />
        </div>
        <p className="field-note text-sm text-subtext text-center italic mb-6">
          Canis cyberus vagans · 初次见面
        </p>
        <div className="space-y-3 mb-8 min-h-[12rem]">
          {introLines.slice(0, lineIndex).map((line) => (
            <p key={line} className="field-note text-lg text-[var(--c-faded-ink)] leading-relaxed">
              {line}
            </p>
          ))}
          <p className="field-note text-lg text-[var(--c-faded-ink)] leading-relaxed">
            <TypewriterText text={introLines[lineIndex] ?? ''} speed={35} onComplete={advanceLine} />
          </p>
          {done && (
            <p className="field-note text-base text-subtext pt-2">
              —— 准备好了吗?
            </p>
          )}
        </div>
        <button
          onClick={onDone}
          autoFocus={done}
          className="w-full py-3 rounded-sm bg-[var(--c-ink)] text-[var(--c-paper)] font-heading font-medium
            hover:shadow-[0_2px_0_0_var(--c-amber)] transition-all"
        >
          带它回家
        </button>
      </motion.div>
    </div>
  );
}
