"use client";

import { useEffect, useState } from "react";

/**
 * 图鉴毛色皮肤（delight B12，DESIGN.md §7）：橘/黑/三花三套重映射 + 名牌。
 * localStorage 记住选择（跨页面），图鉴/街角消费同一 key。
 * 重映射能力在 B 侧原型实证（prototype/sprite-ab），此处为 CSS 滤镜快速版：
 * hue-rotate 对黑猫不可用，故黑猫用 brightness(0.25) + saturate(0.3) 近似。
 */
export type CoatId = "orange" | "black" | "calico";

const COATS: Array<{ id: CoatId; label: string; filter: string }> = [
  { id: "orange", label: "橘", filter: "none" },
  { id: "black", label: "黑", filter: "brightness(0.25) saturate(0.3)" },
  { id: "calico", label: "三花", filter: "hue-rotate(-40deg) saturate(1.2)" },
];

const KEY = "sb_coat";

export function getCoat(): CoatId {
  if (typeof window === "undefined") return "orange";
  const v = window.localStorage.getItem(KEY);
  return v === "black" || v === "calico" ? v : "orange";
}

export function coatFilter(id: CoatId): string {
  return COATS.find((c) => c.id === id)?.filter ?? "none";
}

/** 毛色选择器（图鉴皮肤设置行）。 */
export function CoatPicker() {
  const [coat, setCoat] = useState<CoatId>("orange");
  useEffect(() => {
    setCoat(getCoat());
  }, []);
  const pick = (id: CoatId): void => {
    setCoat(id);
    window.localStorage.setItem(KEY, id);
    window.dispatchEvent(new CustomEvent("sb-coat", { detail: id }));
  };
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-[var(--curb)]">毛色皮肤：</span>
      {COATS.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => pick(c.id)}
          className={`border-2 px-2 py-1 text-[12px] ${coat === c.id ? "border-[var(--ok)] bg-[var(--panel)] text-[var(--ok)]" : "border-[var(--curb)] bg-[var(--panel)] text-[var(--paper)]"}`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
