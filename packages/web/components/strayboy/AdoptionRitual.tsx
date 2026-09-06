"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { listPersonalities, type PersonalityId } from "@cyber-stray/shared";
import type { Catchphrase } from "@cyber-stray/shared";
import { PetSprite } from "@/components/strayboy/PetSprite";
import type { SpriteContract } from "@/lib/strayboy/sprite";

/** 默认初始兴趣（与服务端 DEFAULT_ADOPTION_INTERESTS 一致；贴纸多选可改）。 */
const SUGGESTED_INTERESTS = [
  "科技", "AI", "互联网", "编程", "开源", "硬件", "游戏", "音乐",
  "电影", "设计", "心理学", "哲学", "经济学", "天文", "生物", "历史",
];
/** "换一批"上限（含首次共 4 次请求；ADR 0005 限流防成本滥用）。 */
const MAX_BATCH = 3;
/** 候选请求（POST /api/pets/adoption-candidates → LLM 3 候选）。失败显式报错，不静默降级。 */
async function fetchCandidates(body: {
  step: "name" | "catchphrase";
  name?: string;
  personality?: PersonalityId;
  batch: number;
}): Promise<string[]> {
  const res = await fetch("/api/pets/adoption-candidates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { success: boolean; data?: { candidates: string[] } };
  if (!json.success || !json.data) {
    throw new Error("候选生成失败，稍后再换一批");
  }
  return json.data.candidates;
}

const PERSONALITIES = listPersonalities();

/**
 * 领养开机仪式（#170：全屏开机画面，PetIntro 并入终点）：
 * ▶ NEW GAME → 起名（LLM 3 候选 + 换一批×3 + 可手输）→ 性格 4 卡 → 口头禅 → 兴趣贴纸
 * → 猫 walk 入场 + 自我介绍 → 开始游荡（confirm 时唯一一处方块纸屑）。
 */
export function AdoptionRitual({
  contract,
  adopt,
  adopting,
  onAdopted,
}: {
  contract: SpriteContract;
  adopt: (input: {
    name: string;
    interests?: string[];
    personality?: PersonalityId;
    catchphrases?: Catchphrase[];
  }) => Promise<unknown>;
  adopting: boolean;
  onAdopted: () => void;
}) {
  const [step, setStep] = useState<"title" | "name" | "personality" | "catchphrase" | "interests" | "entered">("title");
  const [name, setName] = useState("");
  const [personality, setPersonality] = useState<PersonalityId | null>(null);
  const [catchphrases, setCatchphrases] = useState<Catchphrase[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [batches, setBatches] = useState<{ name: number; catchphrase: number }>({ name: 0, catchphrase: 0 });
  const [customInput, setCustomInput] = useState("");
  const [entered, setEntered] = useState(false);
  const requestIdRef = useRef(0);

  const loadCandidates = useCallback(async (step: "name" | "catchphrase", batch: number, extra: { name?: string; personality?: PersonalityId }) => {
    const id = ++requestIdRef.current;
    setLoadingCandidates(true);
    setCandidatesError(null);
    try {
      const list = await fetchCandidates({ step, batch, ...extra });
      if (id !== requestIdRef.current) return; // 过期响应（换批/切步）丢弃
      setCandidates(list);
    } catch (err) {
      if (id !== requestIdRef.current) return;
      setCandidatesError(err instanceof Error ? err.message : "候选请求失败");
    } finally {
      if (id === requestIdRef.current) setLoadingCandidates(false);
    }
  }, []);

  // 口头禅候选依赖 name+personality，进步骤时取一批
  useEffect(() => {
    if (step !== "catchphrase") return;
    void loadCandidates("catchphrase", batches.catchphrase, { name, personality: personality ?? undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const pickInterests = (topic: string): void => {
    setInterests((cur) => cur.includes(topic) ? cur.filter((t) => t !== topic) : [...cur, topic]);
  };

  const confirmAdopt = async (): Promise<void> => {
    const result = await adopt({
      name,
      personality: personality ?? undefined,
      catchphrases: catchphrases.length > 0 ? catchphrases : undefined,
      interests: interests.length > 0 ? interests : undefined,
    });
    if (!result) return; // adopt 失败由 hook error 态显式呈现
    confetti({
      particleCount: 80,
      shapes: ["square"],
      colors: ["#F7D51D", "#209CEE", "#92CC41", "#F8F5F5"],
      disableForReducedMotion: true,
    });
    setStep("entered");
    setEntered(true);
  };

  if (step === "title") {
    return (
      <div className="sb flex min-h-[70vh] flex-col items-center justify-center gap-8 bg-[var(--sky)]">
        <p className="font-ps2p text-[16px] text-[var(--paper)]">STRAY-BOY</p>
        <button
          type="button"
          className="sb-blink font-ps2p text-sm text-[var(--star)]"
          onClick={() => setStep("name")}
        >
          ▶ NEW GAME
        </button>
      </div>
    );
  }

  if (step === "entered") {
    return (
      <div className="sb flex min-h-[70vh] flex-col items-center justify-center gap-6 bg-[var(--sky)]">
        <PetSprite contract={contract} anim={entered ? "walk" : "idle"} scale={3} />
        <div className="relative max-w-[300px]">
          <span className="absolute -top-3 left-3 border-2 border-[var(--ink)] bg-[var(--paper)] px-1.5 py-0.5 font-ps2p text-xs leading-none text-[var(--ink)]">
            {name}
          </span>
          <div className="border-4 border-[var(--ink)] bg-[var(--paper)] px-3 py-2.5 text-[14px] leading-[1.6] text-[var(--ink)] shadow-[6px_6px_0_#000]">
            {`我叫${name}。从今晚起我出门替你逛这座城——找到好货就寄明信片。`}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onAdopted()}
          className="sb-shadow border-2 border-black bg-[var(--act)] px-4 py-2 font-ps2p text-xs text-[var(--sky)]"
        >
          开始游荡
        </button>
      </div>
    );
  }

  return (
    <div className="sb mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center gap-4 p-4">
      <p className="font-ps2p text-xs text-[var(--hi)]">
        {step === "name" ? "1/4 给它起个名" : step === "personality" ? "2/4 选性格" : step === "catchphrase" ? "3/4 口头禅" : "4/4 挑兴趣贴纸"}
      </p>

      {step === "name" && (
        <div className="flex flex-col gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="直接输入，或从下面挑一个"
            maxLength={12}
            className="border-2 border-[var(--curb)] bg-[var(--paper)] px-3 py-2 text-[15px] text-[var(--ink)]"
          />
          {loadingCandidates && <p className="text-[13px] text-[var(--curb)]">LLM 构思中……</p>}
          {candidatesError && <p className="text-[13px] text-[var(--bad)]">{candidatesError}</p>}
          <div className="flex flex-wrap gap-2">
            {candidates.map((c) => (
              <button key={c} type="button" onClick={() => setName(c)}
                className="border-2 border-[var(--curb)] bg-[var(--panel)] px-3 py-1.5 text-[13px] text-[var(--paper)]">
                {c}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={loadingCandidates || batches.name >= MAX_BATCH}
            onClick={() => { const b = batches.name + 1; setBatches((s) => ({ ...s, name: b })); void loadCandidates("name", b, {}); }}
            className="self-start border-2 border-[var(--curb)] bg-[var(--panel)] px-3 py-1.5 text-[13px] text-[var(--hi)]"
          >
            换一批（剩 {MAX_BATCH - batches.name} 次）
          </button>
          <button
            type="button"
            disabled={name.trim().length === 0}
            onClick={() => setStep("personality")}
            className="sb-shadow self-end border-2 border-black bg-[var(--act)] px-4 py-2 text-[13px] text-[var(--sky)] disabled:opacity-40"
          >
            下一步 ▶
          </button>
        </div>
      )}

      {step === "personality" && (
        <div className="flex flex-col gap-3">
          {PERSONALITIES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPersonality(p.id)}
              className={`border-2 p-3 text-left ${personality === p.id ? "border-[var(--act)] bg-[var(--panel)]" : "border-[var(--curb)] bg-[var(--panel)]"}`}
            >
              <p className="text-[15px] text-[var(--paper)]">{p.id} · {p.description}</p>
            </button>
          ))}
          <div className="flex justify-between">
            <button type="button" onClick={() => setStep("name")} className="px-3 py-2 text-[13px] text-[var(--curb)]">◀ 上一步</button>
            <button
              type="button"
              disabled={!personality}
              onClick={() => setStep("catchphrase")}
              className="sb-shadow border-2 border-black bg-[var(--act)] px-4 py-2 text-[13px] text-[var(--sky)] disabled:opacity-40"
            >
              下一步 ▶
            </button>
          </div>
        </div>
      )}

      {step === "catchphrase" && (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-[var(--curb)]">它的口头禅（可多选/手输；空 = 用性格默认组）</p>
          {loadingCandidates && <p className="text-[13px] text-[var(--curb)]">LLM 构思中……</p>}
          {candidatesError && <p className="text-[13px] text-[var(--bad)]">{candidatesError}</p>}
          <div className="flex flex-wrap gap-2">
            {candidates.map((c) => {
              const on = catchphrases.some((x) => x.text === c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCatchphrases((cur) => on ? cur.filter((x) => x.text !== c) : [...cur, { text: c, weight: 1 }])}
                  className={`border-2 px-3 py-1.5 text-[13px] ${on ? "border-[var(--ok)] bg-[var(--panel)] text-[var(--ok)]" : "border-[var(--curb)] bg-[var(--panel)] text-[var(--paper)]"}`}
                >
                  {c}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <input
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="自定义口头禅"
              maxLength={30}
              className="flex-1 border-2 border-[var(--curb)] bg-[var(--paper)] px-3 py-2 text-[14px] text-[var(--ink)]"
            />
            <button
              type="button"
              disabled={customInput.trim().length === 0}
              onClick={() => { setCatchphrases((cur) => [...cur, { text: customInput.trim(), weight: 1 }]); setCustomInput(""); }}
              className="border-2 border-[var(--curb)] bg-[var(--panel)] px-3 text-[13px] text-[var(--paper)]"
            >
              添加
            </button>
          </div>
          <div className="flex justify-between">
            <button type="button" onClick={() => setStep("personality")} className="px-3 py-2 text-[13px] text-[var(--curb)]">◀ 上一步</button>
            <button
              type="button"
              onClick={() => setStep("interests")}
              className="sb-shadow border-2 border-black bg-[var(--act)] px-4 py-2 text-[13px] text-[var(--sky)]"
            >
              下一步 ▶
            </button>
          </div>
        </div>
      )}

      {step === "interests" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_INTERESTS.map((topic) => {
              const on = interests.includes(topic);
              return (
                <button
                  key={topic}
                  type="button"
                  onClick={() => pickInterests(topic)}
                  className={`border-2 px-3 py-1.5 text-[13px] ${on ? "border-[var(--ok)] bg-[var(--panel)] text-[var(--ok)]" : "border-[var(--curb)] bg-[var(--panel)] text-[var(--paper)]"}`}
                >
                  {topic}
                </button>
              );
            })}
          </div>
          <div className="flex justify-between">
            <button type="button" onClick={() => setStep("catchphrase")} className="px-3 py-2 text-[13px] text-[var(--curb)]">◀ 上一步</button>
            <button
              type="button"
              disabled={adopting}
              onClick={() => void confirmAdopt()}
              className="sb-shadow border-2 border-black bg-[var(--ok)] px-4 py-2 font-ps2p text-xs text-[var(--sky)]"
            >
              {adopting ? "登记中……" : "开始游荡（领养）"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
