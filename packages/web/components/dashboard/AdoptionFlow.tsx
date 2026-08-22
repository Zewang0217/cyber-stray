"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  listPersonalities,
  DEFAULT_PERSONALITY,
  type Catchphrase,
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

/** "换一批"上限（含首次共 4 次请求；ADR 0005 限流防成本滥用） */
const MAX_BATCH = 3;
/** 口头禅集合上限（与服务端 parseCatchphraseList 一致） */
const CATCHPHRASE_MAX = 6;

interface AdoptionFlowProps {
  adopting: boolean;
  onAdopt: (input: {
    name: string;
    interests?: string[];
    personality?: PersonalityId;
    catchphrases?: Catchphrase[];
  }) => Promise<Pet | null>;
}

/** 候选请求（POST /api/pets/adoption-candidates → LLM 3 候选,失败降级本地模板） */
async function fetchCandidates(body: {
  step: "name" | "catchphrase";
  name?: string;
  personality?: PersonalityId;
  batch: number;
}): Promise<string[] | null> {
  try {
    const res = await fetch("/api/pets/adoption-candidates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { success: boolean; data?: { candidates: string[] } };
    return json.success && json.data ? json.data.candidates : null;
  } catch {
    return null;
  }
}

/**
 * 候选选择器：3 候选点选 + "换一批"（限 3 次,超限禁用）。
 * name 步单选（填入输入框）；catchphrase 步多选进集合。
 */
function useCandidates(step: "name" | "catchphrase", deps: { name?: string; personality?: PersonalityId } = {}) {
  const [candidates, setCandidates] = useState<string[]>([]);
  const [batch, setBatch] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (nextBatch: number) => {
      setLoading(true);
      const out = await fetchCandidates({ step, batch: nextBatch, ...deps });
      if (out) setCandidates(out);
      setLoading(false);
    },
    // deps 内容变化才重新拉（name/personality 进入 catchphrase 步时）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step, deps.name, deps.personality],
  );

  useEffect(() => {
    void load(0);
    setBatch(0);
  }, [load]);

  const refresh = () => {
    if (batch >= MAX_BATCH || loading) return;
    const next = batch + 1;
    setBatch(next);
    void load(next);
  };

  return { candidates, loading, batch, refresh, exhausted: batch >= MAX_BATCH };
}

/** 步骤卡入场/退场动画参数（四步共用） */
const stepMotion = {
  initial: { opacity: 0, x: -20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 20 },
  transition: { type: "spring" as const, stiffness: 300, damping: 28 },
};

/**
 * 领养流程（S7 + #90 + #114）：起名 → 选性格（优劣说明） → 选口头禅 → 选初始兴趣 → 领养。
 * 起名/口头禅步 AI 给 3 候选（可点选可自写,"换一批"限 3 次;LLM 失败降级本地模板）。
 * 图鉴世界:图鉴登记新标本。领养成功后 onAdopt 返回宠物,父组件切换到自我介绍。
 */
export function AdoptionFlow({ adopting, onAdopt }: AdoptionFlowProps): React.ReactElement {
  const [step, setStep] = useState<"name" | "personality" | "catchphrase" | "interests">("name");
  const [name, setName] = useState("");
  const [personality, setPersonality] = useState<PersonalityId>(DEFAULT_PERSONALITY);
  const [catchphraseList, setCatchphraseList] = useState<Catchphrase[]>([]);
  const [customPhrase, setCustomPhrase] = useState("");
  const [interests, setInterests] = useState<string[]>(DEFAULT_INTERESTS);
  const [error, setError] = useState<string | null>(null);

  const nameCandidates = useCandidates("name");
  const phraseCandidates = useCandidates("catchphrase", { name, personality });

  const toggleInterest = (topic: string) => {
    setInterests((prev) =>
      prev.includes(topic) ? prev.filter((t) => t !== topic) : [...prev, topic],
    );
  };

  const togglePhrase = (text: string) => {
    setCatchphraseList((prev) =>
      prev.some((c) => c.text === text)
        ? prev.filter((c) => c.text !== text)
        : prev.length >= CATCHPHRASE_MAX ? prev : [...prev, { text, weight: 1 }],
    );
  };

  const addCustomPhrase = () => {
    const text = customPhrase.trim();
    if (text.length === 0 || text.length > 24) {
      setError("口头禅需要 1-24 个字符");
      return;
    }
    if (catchphraseList.length >= CATCHPHRASE_MAX) {
      setError(`最多 ${CATCHPHRASE_MAX} 条口头禅`);
      return;
    }
    if (!catchphraseList.some((c) => c.text === text)) {
      setCatchphraseList((prev) => [...prev, { text, weight: 1 }]);
    }
    setCustomPhrase("");
    setError(null);
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
    setStep("catchphrase");
  };

  const submitCatchphrase = () => {
    if (catchphraseList.length === 0) {
      setError("至少选一条口头禅——这是它说话的招牌");
      return;
    }
    setError(null);
    setStep("interests");
  };

  const submitAdopt = async () => {
    if (interests.length === 0) {
      setError("至少选一个兴趣");
      return;
    }
    const pet = await onAdopt({
      name: name.trim(),
      interests,
      personality,
      catchphrases: catchphraseList,
    });
    if (!pet) setError("领养失败,请重试");
  };

  const back = (target: "name" | "personality" | "catchphrase") => {
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
            <motion.div key="name" {...stepMotion} className="paper-card p-8 rounded-sm">
              <p className="field-note text-sm text-subtext mb-2">Adoption · 领养</p>
              <h2 className="font-heading text-2xl font-semibold text-text mb-4">
                给小家伙起个名字吧
              </h2>
              <p className="text-small text-subtext leading-relaxed mb-6">
                它马上就要跟你回家了——先叫它什么?
              </p>
              <div className="flex flex-wrap gap-2 mb-4">
                {nameCandidates.loading && candidatesEmpty(nameCandidates.candidates) ? (
                  <span className="text-small text-subtext">想名字中…</span>
                ) : (
                  nameCandidates.candidates.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setName(c)}
                      className={`px-3 py-1.5 rounded-sm text-sm font-heading transition-colors
                        ${name === c
                          ? "bg-[var(--c-ink)] text-[var(--c-paper)] border border-[var(--c-ink)]"
                          : "bg-[var(--c-paper)] text-subtext hover:text-text border border-[var(--c-engraving-fine)]"}`}
                    >
                      {c}
                    </button>
                  ))
                )}
              </div>
              <div className="flex items-center gap-2 mb-4">
                <button
                  type="button"
                  onClick={nameCandidates.refresh}
                  disabled={nameCandidates.exhausted || nameCandidates.loading}
                  className="text-xs underline underline-offset-2 text-[var(--c-amber-ink)] disabled:opacity-40 disabled:no-underline"
                >
                  {nameCandidates.exhausted ? "换一批(次数用完啦)" : `换一批(${nameCandidates.batch}/3)`}
                </button>
              </div>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitName()}
                placeholder="或者自己写一个:比如 小溜"
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
                就叫这个
              </button>
            </motion.div>
          ) : step === "personality" ? (
            <motion.div key="personality" {...stepMotion} className="paper-card p-8 rounded-sm">
              <p className="field-note text-sm text-subtext mb-2">Personality · 性格</p>
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
                          {active && <span className="ml-2 text-xs text-[var(--c-amber)]">✓ 已选</span>}
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
                  就是这种性格
                </button>
              </div>
            </motion.div>
          ) : step === "catchphrase" ? (
            <motion.div key="catchphrase" {...stepMotion} className="paper-card p-8 rounded-sm">
              <p className="field-note text-sm text-subtext mb-2">Catchphrase · 口头禅</p>
              <h2 className="font-heading text-2xl font-semibold text-text mb-2">
                {name} 平时爱说什么?
              </h2>
              <p className="text-small text-subtext leading-relaxed mb-6">
                挑几句它的招牌话——之后它说话会带着这些口头禅,
                你点赞它会说得更多,踩它会慢慢改口。
              </p>
              <div className="flex flex-wrap gap-2 mb-4">
                {phraseCandidates.loading && candidatesEmpty(phraseCandidates.candidates) ? (
                  <span className="text-small text-subtext">琢磨口头禅中…</span>
                ) : (
                  phraseCandidates.candidates.map((c) => {
                    const active = catchphraseList.some((x) => x.text === c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => togglePhrase(c)}
                        className={`px-3 py-1.5 rounded-sm text-sm font-heading transition-colors
                          ${active
                            ? "bg-[var(--c-ink)] text-[var(--c-paper)] border border-[var(--c-ink)]"
                            : "bg-[var(--c-paper)] text-subtext hover:text-text border border-[var(--c-engraving-fine)]"}`}
                      >
                        {c}
                      </button>
                    );
                  })
                )}
              </div>
              <div className="flex items-center gap-2 mb-4">
                <button
                  type="button"
                  onClick={phraseCandidates.refresh}
                  disabled={phraseCandidates.exhausted || phraseCandidates.loading}
                  className="text-xs underline underline-offset-2 text-[var(--c-amber-ink)] disabled:opacity-40 disabled:no-underline"
                >
                  {phraseCandidates.exhausted ? "换一批(次数用完啦)" : `换一批(${phraseCandidates.batch}/3)`}
                </button>
                <span className="text-xs text-subtext">
                  已选 {catchphraseList.length}/{CATCHPHRASE_MAX}
                </span>
              </div>
              <div className="flex gap-2 mb-4">
                <input
                  value={customPhrase}
                  onChange={(e) => setCustomPhrase(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addCustomPhrase()}
                  placeholder="也可以自己教它一句"
                  maxLength={24}
                  className="flex-1 px-4 py-2 rounded-sm bg-[var(--c-paper)] border border-[var(--c-engraving-fine)]
                    text-text placeholder:text-subtext focus:outline-none focus:border-[var(--c-amber)] text-small"
                />
                <button
                  type="button"
                  onClick={addCustomPhrase}
                  className="px-4 py-2 rounded-sm border border-[var(--c-engraving-fine)] text-small text-subtext
                    hover:text-text hover:border-[var(--c-amber)] transition-colors"
                >
                  教它
                </button>
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
                  onClick={submitCatchphrase}
                  disabled={catchphraseList.length === 0}
                  className="flex-1 py-3 rounded-sm bg-[var(--c-ink)] text-[var(--c-paper)] font-heading font-medium
                    hover:shadow-[0_2px_0_0_var(--c-amber)] transition-all disabled:opacity-50"
                >
                  就爱这么说
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="interests" {...stepMotion} className="paper-card p-8 rounded-sm">
              <p className="field-note text-sm text-subtext mb-2">Interests · 初始兴趣</p>
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
                  onClick={() => back("catchphrase")}
                  className="flex-1 py-3 rounded-sm border border-[var(--c-engraving-fine)] text-subtext
                    hover:text-text hover:border-[var(--c-amber)] transition-colors"
                >
                  返回改口头禅
                </button>
                <button
                  onClick={() => void submitAdopt()}
                  disabled={adopting || interests.length === 0}
                  className="flex-1 py-3 rounded-sm bg-[var(--c-ink)] text-[var(--c-paper)] font-heading font-medium
                    hover:shadow-[0_2px_0_0_var(--c-amber)] transition-all disabled:opacity-50"
                >
                  {adopting ? "办理领养中…" : `带 ${name} 回家`}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function candidatesEmpty(list: string[]): boolean {
  return list.length === 0;
}
