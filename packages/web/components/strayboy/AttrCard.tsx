"use client";

import type { AgentState } from "@/lib/types";
import type { PetRecord } from "@/lib/strayboy/pet-view";

const PERSONALITY_LABEL: Record<string, string> = {
  curious: "好奇",
  playful: "贪玩",
  lazy: "慵懒",
  steady: "沉稳",
};

/**
 * 角色属性卡（US6 / #170 街角行）：点 LV 名牌弹出 paper 卡——
 * 性格/口头禅/固执/连续失败/里程。数据全来自 CP state 与 pet 记录，无新字段。
 */
export function AttrCard({
  pet,
  state,
  level,
  onClose,
}: {
  pet: PetRecord;
  state: AgentState | null;
  level: number;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[65] bg-black/80 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-label="角色属性卡">
      <div
        className="relative w-full max-w-xs border-4 border-[var(--ink)] bg-[var(--paper)] p-5 pt-7 shadow-[8px_8px_0_#000]"
        onClick={(e) => e.stopPropagation()}
      >
        <span aria-hidden className="absolute left-1/2 top-1 h-2 w-2 -translate-x-1/2 bg-[var(--bad)]" />
        <h2 className="font-ps2p mb-4 text-xs text-[var(--ink)]">
          LV{level} · {pet.name}
        </h2>
        <dl className="flex flex-col gap-2 text-[13.5px] leading-[1.7] text-[var(--ink)]">
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--curb)]">性格</dt>
            <dd>{pet.personality ? PERSONALITY_LABEL[pet.personality] ?? pet.personality : "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--curb)]">口头禅</dt>
            <dd className="text-right">
              {(pet.catchphrases ?? []).map((c) => c.text).join(" / ") || "（性格默认组）"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--curb)]">固执</dt>
            <dd>{state?.stubbornness ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--curb)]">连续失败</dt>
            <dd>{state?.consecutiveFailures ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--curb)]">里程（步）</dt>
            <dd className="font-vt323 text-[18px]">{state?.totalSteps ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--curb)]">游荡/推送</dt>
            <dd>{state ? `${state.totalWanders} / ${state.totalPushes}` : "—"}</dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full border-2 border-[var(--ink)] bg-[var(--panel)] px-3 py-1.5 text-[12px] text-[var(--paper)]"
        >
          合上 ◀
        </button>
      </div>
    </div>
  );
}
