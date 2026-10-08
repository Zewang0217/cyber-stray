"use client";

import { useState } from "react";
import { PET_STATE_IDS, PET_SHEET_STATE_IDS, PET_STATES, type PetStateId } from "@cyber-stray/shared/pet";
import { parseSpriteContract } from "@cyber-stray/shared/sprite";
import { usePetManifest } from "@/hooks/usePetManifest";
import frames from "@/public/pet/strayboy/frames.json";
import { StreetPet } from "./StreetPet";

const builtin = parseSpriteContract(frames);

/** 独立预览已交付素材；不改宠物真实状态，也不触发生图或预算消耗。 */
export function PetAppearancePreview({ refreshToken = 0 }: { refreshToken?: number }) {
  const assets = usePetManifest({ refreshToken });
  const [selected, setSelected] = useState<PetStateId>("idle");
  if (!assets.loaded) return <p role="status">正在读取外观…</p>;
  if (assets.error) return <p role="alert" className="text-[var(--bad)]">{assets.error}</p>;
  if (!assets.appearance) return null;
  const states = assets.appearance.kind === "sprite" ? PET_SHEET_STATE_IDS : PET_STATE_IDS;
  return (
    <section className="mb-5 border-2 border-[var(--curb)] bg-[var(--panel)] p-4">
      <h2 className="mb-2 text-[14px] text-[var(--paper)]">当前形象 · 动作预览</h2>
      <p className="text-[12px] leading-relaxed text-[var(--curb)]">点击查看不同姿态。预览不改变作息，也不消耗生成次数。</p>
      <div className="my-5 flex min-h-56 items-center justify-center" aria-live="polite">
        <div style={{ zoom: 2 }}><StreetPet {...assets} contract={builtin} anim={selected} /></div>
      </div>
      <div className="grid grid-cols-3 gap-2" aria-label="动作选择">
        {states.map((state) => (
          <button key={state} type="button" aria-pressed={selected === state} onClick={() => setSelected(state)}
            className={`border-2 p-2 text-[13px] ${selected === state ? "border-[var(--ok)] text-[var(--ok)]" : "border-[var(--curb)] text-[var(--paper)]"}`}>
            {PET_STATES[state].label}
          </button>
        ))}
      </div>
    </section>
  );
}
