"use client";

import { useState } from "react";
import type { PetGenTaskStatus, PetGenTaskView } from "@cyber-stray/shared/petgen";
import styles from "./GenerationWorkshop.module.css";

/** 仅呈现 CP 的真实阶段；分段路标不是百分比，也不预估剩余时间。 */
const STAGES: Record<PetGenTaskStatus, { index: number; title: string; detail: string }> = {
  spec_submitted: { index: 0, title: "你的街溜子正在排队报到", detail: "描述已经收到，轮到它就开始画。" },
  concept_generating: { index: 0, title: "第一次见面的模样，正在画", detail: "先把眼神和轮廓定下来，再准备它在街区里的动作。" },
  awaiting_confirmation: { index: 1, title: "它想先和你打个照面", detail: "看看这张概念图，确认喜欢后再继续。" },
  generating_states: { index: 2, title: "正在练习出门的姿势", detail: "走路、打盹、偷乐……正在生成街区里的动作素材。" },
  qc: { index: 3, title: "出门前，再照一次镜子", detail: "正在检查形象和动作；不合格的素材需要重做。" },
  done: { index: 4, title: "准备好了，街角见！", detail: "专属形象已完成，回到街角就能看到它。" },
  failed: { index: -1, title: "这次见面遇到了一点麻烦", detail: "生成已停止，请查看原因和可用的重试方式。" },
};
const LABELS = ["画模样", "见一面", "练动作", "照镜子", "街角见"];
const KNOCK_LINES = ["里面传来一声：喵，别偷看。", "它把门拉开一条缝，又关上了。", "小纸条：等我整理好胡须。"];

/** 生图等待的小工坊：真实概念图、阶段路标和无需额外请求的敲门互动。 */
export function GenerationWorkshop({ task, compact = false }: { task: PetGenTaskView; compact?: boolean }) {
  const [knocks, setKnocks] = useState(0);
  const [brokenImage, setBrokenImage] = useState<string | null>(null);
  const stage = STAGES[task.status];
  const busy = ["spec_submitted", "concept_generating", "generating_states", "qc"].includes(task.status);
  return (
    <section className={`${styles.panel} ${styles.entry} ${compact ? styles.compact : ""}`} aria-label="形象小工坊">
      <p className="font-ps2p mb-4 text-xs text-[var(--hi)]">PET WORKSHOP</p>
      <div className={styles.scene}>
        <div className={styles.portrait}>
          {task.conceptUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={task.conceptUrl} alt="正在制作的宠物概念图" onError={() => setBrokenImage(task.conceptUrl)} />
          ) : <span className={styles.ticket} aria-hidden>?</span>}
          {busy && <span className={styles.scan} aria-hidden />}
        </div>
        <div aria-live="polite">
          <h2 className="text-[16px] text-[var(--paper)]">{stage.title}</h2>
          {!compact && <p className="font-noto mt-2 text-[13px] leading-6 text-[var(--paper)]">{stage.detail}</p>}
        </div>
      </div>
      {task.conceptUrl && brokenImage === task.conceptUrl && <p role="alert" className="mt-2 text-[13px] text-[var(--bad)]">概念图加载失败，请刷新页面重试。</p>}
      {!compact && <ol className={styles.rail} aria-label="生成阶段">
        {LABELS.map((label, index) => <li key={label} data-reached={stage.index >= index} aria-current={stage.index === index ? "step" : undefined}>{label}</li>)}
      </ol>}
      {busy && <>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setKnocks((n) => n + 1)} className="min-h-11 border-2 border-[var(--curb)] px-3 text-[13px] text-[var(--hi)]">敲敲门</button>
          <p key={knocks} role="status" className={`${styles.reaction} text-[13px] text-[var(--paper)]`}>{knocks ? KNOCK_LINES[(knocks - 1) % KNOCK_LINES.length] : "它在里面忙，你在外面等。"}</p>
        </div>
        {!compact && <p className="font-noto mt-3 text-[13px] leading-6 text-[var(--paper)]">可以先逛街区，制作会在后台继续。关掉页面也没关系，回来就能查看进度。</p>}
      </>}
    </section>
  );
}
