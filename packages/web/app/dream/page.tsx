"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BootFrame } from "@/components/strayboy/BootFrame";
import { DEMO_DREAMS } from "@/lib/strayboy/demo";

interface DreamEntry {
  date: string;
  title: string;
  content: string;
  excerpt?: string;
}

/** START 子屏·梦呓集（#170）：sky 底 + 星点 + 梦卡浮空；抽象叙事斜体。 */
function DreamInner() {
  const demo = useSearchParams().get("demo") === "1";
  const [entries, setEntries] = useState<DreamEntry[]>(demo ? DEMO_DREAMS : []);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!demo);

  useEffect(() => {
    if (demo) return;
    (async () => {
      try {
        const res = await fetch("/api/dream");
        const json = (await res.json()) as { success: boolean; data?: DreamEntry[]; error?: string };
        if (!json.success) throw new Error(json.error ?? "获取梦境失败");
        setEntries(json.data ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "网络错误");
      } finally {
        setLoading(false);
      }
    })();
  }, [demo]);

  return (
    <div className="sb relative min-h-screen overflow-hidden bg-[var(--sky)] p-4">
      <BootFrame />
      {Array.from({ length: 14 }, (_, i) => (
        <span key={i} aria-hidden className="absolute h-[2px] w-[2px] bg-[var(--star)]"
          style={{ left: `${(i * 61) % 96}%`, top: `${(i * 29) % 88}%` }} />
      ))}
      <div className="mx-auto max-w-2xl">
        <h1 className="font-ps2p mb-1 text-xs text-[var(--hi)]">DREAM · 梦呓集</h1>
        {demo && <p className="mb-2 text-[12px] text-[var(--bad)]">演示数据</p>}
        {error && (
          <p className="mb-3 border-2 border-[var(--bad)] bg-[var(--panel)] p-2 text-[13px] text-[var(--bad)]">取梦失败：{error}</p>
        )}
        {loading && <p className="py-10 text-[13px] text-[var(--curb)]">潜入梦境……</p>}
        <div className="mt-4 flex flex-col gap-5">
          {entries.map((e, i) => (
            <article key={e.date}
              className={`border-2 border-[var(--curb)] bg-[var(--panel)] p-4 shadow-[5px_5px_0_#000] ${i % 2 === 0 ? "-rotate-1" : "rotate-1"}`}
              style={{ transform: `translateY(${(i % 3) * 6}px)` }}>
              <span className="font-vt323 text-[20px] text-[var(--curb)]">{e.date}</span>
              <h2 className="mb-1.5 text-[15px] text-[var(--paper)]">{e.title}</h2>
              <p className="font-noto text-[13.5px] italic leading-[1.75] text-[var(--paper)]">{e.excerpt ?? e.content}</p>
            </article>
          ))}
          {entries.length === 0 && !loading && (
            <p className="py-12 text-[13px] text-[var(--curb)]">今晚没有梦。它在等一次真正的深夜。</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <DreamInner />
    </Suspense>
  );
}
