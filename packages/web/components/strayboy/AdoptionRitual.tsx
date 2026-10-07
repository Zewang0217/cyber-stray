"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { CATCHPHRASE_LIST_MAX, CATCHPHRASE_TEXT_MAX, listPersonalities, type Catchphrase, type PersonalityId } from "@cyber-stray/shared";
import { ADOPT_REFERENCE_MIME, ADOPT_REFERENCE_MAX_BYTES } from "@cyber-stray/shared/pet";
import styles from "./GenerationWorkshop.module.css";

/** 默认初始兴趣（与服务端 DEFAULT_ADOPTION_INTERESTS 一致；贴纸多选可改）。 */
const SUGGESTED_INTERESTS = [
  "科技", "AI", "互联网", "编程", "开源", "硬件", "游戏", "音乐",
  "电影", "设计", "心理学", "哲学", "经济学", "天文", "生物", "历史",
];
/** "换一批"上限（含首次共 4 次请求；ADR 0005 限流防成本滥用）。 */
const MAX_BATCH = 3;
const RITUAL_STEPS = [
  { id: "name", label: "起名", title: "1/4 给它起个名" },
  { id: "personality", label: "性格", title: "2/4 选性格" },
  { id: "catchphrase", label: "口头禅", title: "3/4 口头禅" },
  { id: "interests", label: "兴趣", title: "4/4 挑兴趣贴纸" },
] as const;
/** 参考图客户端预校验（mime/上限与 CP 路由同源 shared，快失败省一次上传）。 */
const REFERENCE_MIME = ADOPT_REFERENCE_MIME;
const REFERENCE_MAX_BYTES = ADOPT_REFERENCE_MAX_BYTES;

/**
 * 上传形象参考图（POST /api/pets/adopt/reference，multipart；CP 压白底 JPEG
 * 作为精灵图生成的角色锚点）。上传即时发生（不占领养确认等待），
 * 失败显式呈现但可继续领养——参考图是可选增强，不是领养前提。
 */
async function uploadReference(file: File): Promise<void> {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch("/api/pets/adopt/reference", { method: "POST", body: form });
  const json = (await res.json()) as { success: boolean; error?: string };
  if (!res.ok || !json.success) {
    throw new Error(json.error ?? "上传失败，请换一张试试");
  }
}
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

/** 使用已通过质检的生图管线示例；不将示例误称为用户尚未生成的宠物。 */
function ExamplePet() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/pet/candidates/black-cat.png" alt="生图管线生成的小黑猫示例" width={96} height={96} className={`pixelated shrink-0 ${styles.examplePet}`} />;
}

/** 领养仪式的推送授权钩子（#275 决议 #270-2；缺省 = 不请求，demo/测试用） */
export interface RitualPushHooks {
  /** 确认按钮手势时机调用：仅请求权限，不订阅 */
  requestPermission: () => Promise<boolean>;
  /** 领养成功且已授权后调用：注册 SW + 订阅登记 */
  enable: () => Promise<void>;
}

/**
 * 领养开机仪式（#170：全屏开机画面，PetIntro 并入终点）：
 * ▶ NEW GAME → 起名（LLM 3 候选 + 换一批×3 + 可手输）→ 性格 4 卡 → 口头禅 → 兴趣贴纸
 * → 生图示例相伴 + 自我介绍 → 开始游荡（confirm 时唯一一处方块纸屑）。
 */
export function AdoptionRitual({
  adopt,
  adopting,
  adoptError,
  onAdopted,
  push,
}: {
  adopt: (input: {
    name: string;
    interests?: string[];
    personality?: PersonalityId;
    catchphrases?: Catchphrase[];
  }) => Promise<unknown>;
  adopting: boolean;
  adoptError: string | null;
  onAdopted: () => void;
  /** 通知权限授权进仪式（#275）；拒绝可补开、不阻塞领养 */
  push?: RitualPushHooks;
}) {
  const [step, setStep] = useState<"title" | "name" | "personality" | "catchphrase" | "interests" | "entered">("title");
  const stepIndex = RITUAL_STEPS.findIndex((item) => item.id === step);
  const [name, setName] = useState("");
  const [personality, setPersonality] = useState<PersonalityId | null>(null);
  const [catchphrases, setCatchphrases] = useState<Catchphrase[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [batches, setBatches] = useState<{ name: number; catchphrase: number }>({ name: 0, catchphrase: 0 });
  const [customInput, setCustomInput] = useState("");
  const requestIdRef = useRef(0);
  // 形象参考图（可选）：idle → uploading → done | error
  const [referenceState, setReferenceState] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referencePreview, setReferencePreview] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, [step]);
  useEffect(() => {
    if (!referenceFile) return;
    const url = URL.createObjectURL(referenceFile);
    setReferencePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [referenceFile]);

  const pickReference = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    if (!REFERENCE_MIME.includes(file.type)) {
      setReferenceState("error");
      setReferenceError("仅支持 PNG/JPEG/WebP 图片");
      return;
    }
    if (file.size > REFERENCE_MAX_BYTES) {
      setReferenceState("error");
      setReferenceError("图片须 ≤ 8MB");
      return;
    }
    setReferenceState("uploading");
    setReferenceFile(file);
    setReferenceError(null);
    try {
      await uploadReference(file);
      setReferenceState("done");
    } catch (err) {
      setReferenceError(err instanceof Error ? err.message : "上传失败，请换一张试试");
      setReferenceState("error");
    }
  };

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

  // 起名/口头禅步进入即取首批（ADR-0005：含首次共 4 次请求）
  useEffect(() => {
    if (step !== "name") return;
    setCandidates([]);
    void loadCandidates("name", batches.name, {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (step !== "catchphrase") return;
    setCandidates([]);
    void loadCandidates("catchphrase", batches.catchphrase, { name, personality: personality ?? undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const pickInterests = (topic: string): void => {
    setInterests((cur) => cur.includes(topic) ? cur.filter((t) => t !== topic) : [...cur, topic]);
  };

  const confirmAdopt = async (): Promise<void> => {
    if (adopting || referenceState === "uploading") return;
    // #275 决议 #270-2：权限请求在确认点击的手势时机发出（此刻弹窗最新鲜），
    // 与领养请求并行；无论授权与否领养都不被阻塞，拒绝走首页横幅补开
    const permissionPromise = push ? push.requestPermission() : Promise.resolve(false);
    const result = await adopt({
      name: name.trim(),
      personality: personality ?? undefined,
      catchphrases: catchphrases.length > 0 ? catchphrases : undefined,
      interests: interests.length > 0 ? interests : undefined,
    });
    if (!result) return; // adopt 失败由 hook error 态显式呈现
    void permissionPromise
      .then((granted) => {
        if (granted) return push?.enable();
      })
      .catch(() => {}); // 授权/订阅失败不破坏仪式；横幅兜底补开
    confetti({
      particleCount: 80,
      shapes: ["square"],
      colors: ["#F7D51D", "#209CEE", "#92CC41", "#F8F5F5"],
      disableForReducedMotion: true,
    });
    setStep("entered");
  };

  if (step === "title") {
    return (
      <div className={`sb ${styles.ritual} flex min-h-[70vh] flex-col items-center justify-center gap-6 bg-[var(--sky)] p-4 text-center`}>
        <p className="font-ps2p text-[16px] text-[var(--paper)]">STRAY-BOY</p>
        <ExamplePet />
        <p className="text-[11px] text-[var(--curb)]">示例形象 · 由实际生图管线生成</p>
        <h1 className="text-[20px] text-[var(--paper)]">今晚，有一只街溜子等你领回家。</h1>
        <p className="font-noto max-w-xs text-[13px] leading-6 text-[var(--curb)]">给它一个名字、一点脾气和几样爱好。以后它出门探索，把发现寄给你。</p>
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
      <div className={`sb ${styles.ritual} ${styles.entry} flex min-h-[70vh] flex-col items-center justify-center gap-6 bg-[var(--sky)] p-4 text-center`}>
        <h1 ref={headingRef} tabIndex={-1} className="text-[18px] text-[var(--hi)]">登记好了，第一次见面。</h1>
        <ExamplePet />
        <div className="relative max-w-[300px]">
          <span className="absolute -top-3 left-3 border-2 border-[var(--ink)] bg-[var(--paper)] px-1.5 py-0.5 text-[14px] leading-none text-[var(--ink)]">
            {name}
          </span>
          <div className="border-4 border-[var(--ink)] bg-[var(--paper)] px-3 py-2.5 text-[14px] leading-[1.6] text-[var(--ink)] shadow-[6px_6px_0_#000]">
            {`我叫${name}。从今晚起我出门替你逛这座城——找到好货就寄明信片。`}
          </div>
        </div>
        <p className="font-noto max-w-sm text-[13px] leading-6 text-[var(--paper)]">现在就能进街区，不必等专属形象画完。眼前是示例形象，制作进度会显示在街角。</p>
        <p className="text-[12px] leading-[1.7] text-[var(--curb)]">
          内测期间数据可能随版本调整重置；你的反馈会直接帮这只街溜子长大。
        </p>
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
    <div key={step} className={`sb ${styles.ritual} ${styles.entry} mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center gap-5 p-4`}>
      <ol className="flex gap-2" aria-label="领养步骤">
        {RITUAL_STEPS.map((item, index) => <li key={item.id} aria-current={index === stepIndex ? "step" : undefined}
          className={`flex-1 border-b-4 pb-2 text-center text-[12px] ${index <= stepIndex ? "border-[var(--star)] text-[var(--paper)]" : "border-[var(--curb)] text-[var(--curb)]"}`}>{item.label}</li>)}
      </ol>
      <h1 ref={headingRef} tabIndex={-1} className="text-[18px] text-[var(--hi)]">
        {RITUAL_STEPS[stepIndex].title}
      </h1>
      <div className={styles.preview}>
        <div key={`${name}-${personality}-${catchphrases.length}-${interests.length}`} className={`shrink-0 ${styles.reaction}`}>
          <ExamplePet />
        </div>
        <div><p role="status" className="text-[14px] leading-6 text-[var(--paper)]">{step === "name" ? name.trim() ? `“${name.trim()}”？听起来就很会逛。` : "先给我取个名，以后好叫我回家。"
          : step === "personality" ? personality ? `记住了，我是${PERSONALITIES.find((p) => p.id === personality)?.name}派。` : "挑一种脾气，看看合不合拍。"
          : step === "catchphrase" ? catchphrases.length ? `“${catchphrases.at(-1)?.text}”——这句归我了。` : "以后碰到好东西，我会怎么开口？"
          : interests.length ? `收到 ${interests.length} 枚兴趣贴纸，装进口袋。` : "你爱看什么？给我几条出门的线索。"}</p>
          <p className="mt-1 text-[11px] text-[var(--curb)]">示例形象 · 专属模样在领养后制作</p></div>
      </div>

      {step === "name" && (
        <div className="flex flex-col gap-3">
          <input
            aria-label="宠物名字"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="直接输入，或从下面挑一个"
            maxLength={12}
            className="border-2 border-[var(--curb)] bg-[var(--paper)] px-3 py-2 text-[15px] text-[var(--ink)]"
          />
          {loadingCandidates && <p role="status" className="text-[13px] text-[var(--curb)]">正在翻名字小册子……也可以直接输入。</p>}
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
            onClick={() => { setName(name.trim()); setStep("personality"); }}
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
              aria-pressed={personality === p.id}
              onClick={() => setPersonality(p.id)}
              className={`border-2 p-3 text-left ${personality === p.id ? "border-[var(--act)] bg-[var(--panel)]" : "border-[var(--curb)] bg-[var(--panel)]"}`}
            >
              <p className="text-[15px] text-[var(--paper)]">{p.name} · {p.description}</p>
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
          {loadingCandidates && <p role="status" className="text-[13px] text-[var(--curb)]">正在琢磨第一句招呼……也可以先写一句。</p>}
          {candidatesError && <p className="text-[13px] text-[var(--bad)]">{candidatesError}</p>}
          <div className="flex flex-wrap gap-2">
            {candidates.map((c) => {
              const on = catchphrases.some((x) => x.text === c);
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  disabled={!on && catchphrases.length >= CATCHPHRASE_LIST_MAX}
                  onClick={() => setCatchphrases((cur) => on ? cur.filter((x) => x.text !== c) : [...cur, { text: c, weight: 1 }])}
                  className={`border-2 px-3 py-1.5 text-[13px] ${on ? "border-[var(--ok)] bg-[var(--panel)] text-[var(--ok)]" : "border-[var(--curb)] bg-[var(--panel)] text-[var(--paper)]"}`}
                >
                  {c}
                </button>
              );
            })}
          </div>
          {catchphrases.filter((c) => !candidates.includes(c.text)).map((c) => <button type="button" key={c.text}
            onClick={() => setCatchphrases((cur) => cur.filter((p) => p.text !== c.text))}
            className="self-start border-2 border-[var(--ok)] px-3 text-[13px] text-[var(--ok)]">{c.text} × 移除</button>)}
          <button
            type="button"
            disabled={loadingCandidates || batches.catchphrase >= MAX_BATCH}
            onClick={() => { const b = batches.catchphrase + 1; setBatches((cur) => ({ ...cur, catchphrase: b })); void loadCandidates("catchphrase", b, { name, personality: personality ?? undefined }); }}
            className="self-start border-2 border-[var(--curb)] bg-[var(--panel)] px-3 py-1.5 text-[13px] text-[var(--hi)]"
          >
            换一批（剩 {MAX_BATCH - batches.catchphrase} 次）
          </button>
          <div className="flex gap-2">
            <input
              value={customInput}
              aria-label="自定义口头禅"
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="自定义口头禅"
              maxLength={CATCHPHRASE_TEXT_MAX}
              className="flex-1 border-2 border-[var(--curb)] bg-[var(--paper)] px-3 py-2 text-[14px] text-[var(--ink)]"
            />
            <button
              type="button"
              disabled={customInput.trim().length === 0 || catchphrases.length >= CATCHPHRASE_LIST_MAX || catchphrases.some((c) => c.text === customInput.trim())}
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
                  aria-pressed={on}
                  onClick={() => pickInterests(topic)}
                  className={`border-2 px-3 py-1.5 text-[13px] ${on ? "border-[var(--ok)] bg-[var(--panel)] text-[var(--ok)]" : "border-[var(--curb)] bg-[var(--panel)] text-[var(--paper)]"}`}
                >
                  {topic}
                </button>
              );
            })}
          </div>

          {/* 可选角色参考；上传中的照片必须先写入 CP，才能被领养任务使用。 */}
          <div className="flex flex-col gap-1.5 border-2 border-dashed border-[var(--curb)] p-3">
            <p className="text-[13px] text-[var(--paper)]">专属形象（可选）：传一张它的照片，街区形象会更像它</p>
            <div className="flex items-center gap-2">
              <label className="cursor-pointer border-2 border-[var(--curb)] bg-[var(--panel)] px-3 py-1.5 text-[13px] text-[var(--hi)] focus-within:outline-2">
                {referenceState === "done" ? "重新上传" : "选一张照片"}
                <input
                  type="file"
                  accept={REFERENCE_MIME.join(",")}
                  disabled={referenceState === "uploading"}
                  className="sr-only"
                  onChange={(e) => void pickReference(e.target.files?.[0])}
                />
              </label>
              {referenceState === "uploading" && <span className="text-[12px] text-[var(--curb)]">上传中……</span>}
              {referenceState === "done" && <span className="text-[12px] text-[var(--ok)]">收到，就按这张长</span>}
            </div>
            {referencePreview && <figure className="mt-2 flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={referencePreview} alt="选择的宠物参考照片" className="h-20 w-20 border-2 border-[var(--curb)] object-contain" />
              <figcaption className="text-[12px] text-[var(--curb)]">{referenceState === "done" ? "这张照片会作为形象参考。" : "照片尚未上传成功。"}</figcaption>
            </figure>}
            {referenceError && <p className="text-[12px] text-[var(--bad)]">{referenceError}</p>}
          </div>

          <div className="flex justify-between">
            <button type="button" onClick={() => setStep("catchphrase")} className="px-3 py-2 text-[13px] text-[var(--curb)]">◀ 上一步</button>
            {adoptError && <p className="text-[13px] text-[var(--bad)]">领养失败：{adoptError}</p>}
            <button
              type="button"
              disabled={adopting || referenceState === "uploading"}
              onClick={() => void confirmAdopt()}
              className="sb-shadow border-2 border-black bg-[var(--ok)] px-4 py-2 font-ps2p text-xs text-[var(--sky)]"
            >
              {adopting ? "登记中……" : referenceState === "uploading" ? "等待照片上传……" : "开始游荡（领养）"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
