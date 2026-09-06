"use client";

import { useEffect, useMemo, useState } from "react";
import { BootFrame } from "@/components/strayboy/BootFrame";
import { DEMO_DIARY } from "@/lib/strayboy/demo";

interface DiaryEntry {
  date: string;
  title: string;
  content: string;
  excerpt?: string;
}

/** 显式拉取日记（无兜底；失败呈现错误）。 */
function useDiaryEntries(demo: boolean): { entries: DiaryEntry[]; error: string | null; loading: boolean } {
  const [entries, setEntries] = useState<DiaryEntry[]>(demo ? DEMO_DIARY : []);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!demo);
  useEffect(() => {
    if (demo) return;
    (async () => {
      try {
        const res = await fetch("/api/diary");
        const json = (await res.json()) as { success: boolean; data?: DiaryEntry[]; error?: string };
        if (!json.success) throw new Error(json.error ?? "获取日记失败");
        setEntries(json.data ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "网络错误");
      } finally {
        setLoading(false);
      }
    })();
  }, [demo]);
  return { entries, error, loading };
}

/**
 * START 子屏·日记本（#170）：跨页纸面（paper+ink），按月列表 → 单页。
 * 长文一律 Noto Sans SC（宪法 §3）。
 */
export default function DiaryPage() {
  const demo = typeof window !== "undefined" && window.location.search.includes("demo=1");
  const { entries, error, loading } = useDiaryEntries(demo);
  const months = useMemo(() => [...new Set(entries.map((e) => e.date.slice(0, 7)))].sort().reverse(), [entries]);
  const [month, setMonth] = useState<string | null>(null);
  const [openEntry, setOpenEntry] = useState<DiaryEntry | null>(null);
  const visible = month ? entries.filter((e) => e.date.startsWith(month)) : entries;

  return (
    <div className="sb min-h-screen bg-[var(--paper)] p-4">
      <BootFrame />
      <div className="mx-auto max-w-2xl">
        <h1 className="font-ps2p mb-1 text-xs text-[var(--ink)]">DIARY · 日记本</h1>
        {demo && <p className="mb-2 text-[12px] text-[var(--bad)]">演示数据</p>}
        {error && (
          <p className="mb-3 border-2 border-[var(--bad)] bg-[var(--sky)] p-2 text-[13px] text-[var(--bad)]">
            取日记失败：{error}
          </p>
        )}
        {months.length > 1 && (
          <div className="mb-4 flex gap-2">
            {months.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMonth(month === m ? null : m)}
                className={`border-2 px-2 py-1 text-[12px] ${month === m ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]" : "border-[var(--curb)] text-[var(--ink)]"}`}
              >
                {m}
              </button>
            ))}
          </div>
        )}
        {loading && <p className="py-10 text-[13px] text-[var(--curb)]">翻开日记本……</p>}
        <div className="flex flex-col gap-4">
          {visible.map((e) => (
            <article key={e.date} className="border-2 border-[var(--ink)] bg-[#FDFBF5] p-4 shadow-[4px_4px_0_rgba(33,37,41,0.25)]">
              <button type="button" className="w-full text-left" onClick={() => setOpenEntry(e)}>
                <span className="font-vt323 text-[20px] text-[var(--curb)]">{e.date}</span>
                <h2 className="text-[15px] font-medium text-[var(--ink)]">{e.title}</h2>
                <p className="font-noto mt-1 line-clamp-2 text-[13.5px] leading-[1.7] text-[#4A4238]">
                  {e.excerpt ?? e.content}
                </p>
              </button>
            </article>
          ))}
          {visible.length === 0 && !loading && (
            <p className="py-10 text-[13px] text-[var(--curb)]">这一页还没写字。</p>
          )}
        </div>
      </div>
      {openEntry && (
        <div className="fixed inset-0 z-[65] overflow-auto bg-black/90 p-4" role="dialog" onClick={() => setOpenEntry(null)}>
          <article
            className="mx-auto my-8 max-w-2xl border-4 border-[var(--ink)] bg-[#FDFBF5] p-6 shadow-[8px_8px_0_#000]"
            onClick={(ev) => ev.stopPropagation()}
          >
            <span className="font-vt323 text-[20px] text-[var(--curb)]">{openEntry.date}</span>
            <h2 className="mb-3 text-[17px] font-medium text-[var(--ink)]">{openEntry.title}</h2>
            <p className="font-noto whitespace-pre-wrap text-[14px] leading-[1.75] text-[var(--ink)]">
              {openEntry.content}
            </p>
            <button
              type="button"
              onClick={() => setOpenEntry(null)}
              className="mt-5 border-2 border-[var(--ink)] bg-[var(--panel)] px-3 py-1.5 text-[12px] text-[var(--paper)]"
            >
              合上 ◀
            </button>
          </article>
        </div>
      )}
    </div>
  );
}
