"use client";

import { useEffect, useState } from "react";
import {
  CATCHPHRASE_LIST_MAX,
  CATCHPHRASE_TEXT_MAX,
  CATCHPHRASE_WEIGHT_FLOOR,
  type Catchphrase,
} from "@cyber-stray/shared";
import type { Pet } from "@/hooks/usePets";


/**
 * 口头禅编辑卡片（#114 切片 6）：展示当前集合，可改文本/权重/增删，
 * 至少 1 条。保存走 PUT /api/pets/catchphrases，回显由 usePets 刷新承担。
 */
export function CatchphraseEditor({
  pet,
  onSave,
}: {
  pet: Pet | null;
  onSave: (list: Catchphrase[]) => Promise<boolean>;
}): React.ReactElement | null {
  const [draft, setDraft] = useState<Catchphrase[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 服务端集合变化（初次加载/保存后刷新）→ 同步草稿
  useEffect(() => {
    if (!dirty && pet?.catchphrases) setDraft(pet.catchphrases);
  }, [pet?.catchphrases, dirty]);

  if (!pet) return null;

  const update = (i: number, patch: Partial<Catchphrase>) => {
    setDirty(true);
    setSaved(false);
    setDraft((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };
  const remove = (i: number) => {
    if (draft.length <= 1) return; // 至少 1 条
    setDirty(true);
    setSaved(false);
    setDraft((prev) => prev.filter((_, idx) => idx !== i));
  };
  const add = () => {
    if (draft.length >= CATCHPHRASE_LIST_MAX) return;
    setDirty(true);
    setSaved(false);
    setDraft((prev) => [...prev, { text: "", weight: 1 }]);
  };
  const save = async () => {
    const trimmed = draft.map((c) => ({ ...c, text: c.text.trim() }));
    if (trimmed.some((c) => c.text.length === 0 || c.text.length > CATCHPHRASE_TEXT_MAX)) {
      setErr(`每条口头禅需要 1-${CATCHPHRASE_TEXT_MAX} 个字符`);
      return;
    }
    if (trimmed.some((c) => c.weight < CATCHPHRASE_WEIGHT_FLOOR || c.weight > 10)) {
      setErr(`权重须在 ${CATCHPHRASE_WEIGHT_FLOOR}-10 之间`);
      return;
    }
    setErr(null);
    setSaving(true);
    const ok = await onSave(trimmed);
    setSaving(false);
    if (ok) {
      setDirty(false);
      setSaved(true);
    }
  };

  return (
    <div className="p-6 paper-card rounded-sm">
      <h2 className="font-heading text-heading font-semibold text-text mb-1">
        口头禅
      </h2>
      <p className="text-small text-subtext mb-4">
        {pet.name} 说话的招牌。主人点赞会说得更勤，踩会慢慢改口——权重就是它的说话倾向。
      </p>
      <div className="space-y-2 mb-4">
        {draft.map((c, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input
              value={c.text}
              maxLength={CATCHPHRASE_TEXT_MAX}
              onChange={(e) => update(i, { text: e.target.value })}
              placeholder="口头禅文本"
              className="flex-1 px-3 py-2 rounded-sm bg-[var(--c-paper)] border border-[var(--c-engraving-fine)]
                text-text placeholder:text-subtext focus:outline-none focus:border-[var(--c-amber)] text-small"
            />
            <input
              type="number"
              min={CATCHPHRASE_WEIGHT_FLOOR}
              max={10}
              step={0.1}
              value={c.weight}
              onChange={(e) => update(i, { weight: Number(e.target.value) })}
              className="w-20 px-3 py-2 rounded-sm bg-[var(--c-paper)] border border-[var(--c-engraving-fine)]
                text-text focus:outline-none focus:border-[var(--c-amber)] text-small font-mono"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={draft.length <= 1}
              className="px-3 py-2 rounded-sm text-small text-subtext border border-[var(--c-engraving-fine)]
                hover:text-danger hover:border-danger transition-colors disabled:opacity-30"
              aria-label={`删除第 ${i + 1} 条`}
            >
              删
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={add}
          disabled={draft.length >= CATCHPHRASE_LIST_MAX}
          className="px-4 py-2 rounded-sm text-small border border-[var(--c-engraving-fine)] text-subtext
            hover:text-text hover:border-[var(--c-amber)] transition-colors disabled:opacity-30"
        >
          加一条（{draft.length}/{CATCHPHRASE_LIST_MAX}）
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="px-4 py-2 rounded-sm text-small font-semibold bg-[var(--c-ink)] text-[var(--c-paper)]
            hover:shadow-[0_2px_0_0_var(--c-amber)] transition-all disabled:opacity-40"
        >
          {saving ? "保存中…" : saved ? "已保存" : "保存"}
        </button>
        {err ? <span className="text-small text-danger">{err}</span> : null}
      </div>
    </div>
  );
}
