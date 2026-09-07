"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BootFrame } from "@/components/strayboy/BootFrame";
import { useMeme } from "@/hooks/useMeme";
import { DEMO_MEMES } from "@/lib/strayboy/demo";

/**
 * START 子屏·贴纸册（#170）：像素贴纸墙——白描边贴纸 + 像素胶带钉册页。
 * 数据走 useMeme；删除带确认（旧页无确认，#170 补上）；QC 不过不收录（管线侧）。
 */
function StickerInner() {
  const demo = useSearchParams().get("demo") === "1";
  const meme = useMeme();
  const memes = demo ? DEMO_MEMES : (meme.memes ?? []);
  const [confirming, setConfirming] = useState<string | null>(null);

  const remove = async (id: string): Promise<void> => {
    const ok = await meme.remove(id);
    setConfirming(null);
    if (!ok) throw new Error("删除失败（网络/权限）");
  };

  return (
    <div className="sb min-h-screen bg-[var(--panel)] p-4">
      <BootFrame />
      <div className="mx-auto max-w-3xl">
        <h1 className="font-ps2p mb-1 text-xs text-[var(--hi)]">STICKERS · 贴纸册</h1>
        {demo && <p className="mb-3 text-[12px] text-[var(--bad)]">演示数据 · 删除被禁用</p>}
        {!demo && meme.error && (
          <p className="mb-3 border-2 border-[var(--bad)] bg-[var(--sky)] p-2 text-[13px] text-[var(--bad)]">
            取贴纸失败：{meme.error}
          </p>
        )}
        {meme.loading && <p className="py-10 text-[13px] text-[var(--curb)]">翻开册页……</p>}
        <div className="grid grid-cols-2 gap-5 p-1 sm:grid-cols-3">
          {memes.map((m, i) => (
            <figure key={m.id} className={`relative border-4 border-[var(--paper)] bg-[var(--sky)] p-2 shadow-[4px_4px_0_#000] ${i % 2 ? "-rotate-2" : "rotate-1"}`}>
              {/* 像素胶带 */}
              <span aria-hidden className="absolute -top-2 left-1/2 h-3 w-12 -translate-x-1/2 -rotate-3 bg-[var(--window)] opacity-80" />
              {m.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.imageUrl} alt={`贴纸：${m.topic}`} className="pixelated aspect-square w-full object-cover" />
              ) : (
                <div className="aspect-square w-full bg-[var(--bld-far)]" />
              )}
              <figcaption className="mt-1.5 text-center text-[12px] leading-[1.5] text-[var(--paper)]">
                {m.topic} · {m.emotion}
                <span className="block font-vt323 text-[14px] text-[var(--curb)]">{m.date}</span>
              </figcaption>
              {!demo && (
                confirming === m.id ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/85 p-2">
                    <p className="text-[12px] leading-[1.5] text-[var(--paper)]">撕掉这张贴纸？</p>
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => void remove(m.id)}
                        className="border-2 border-[var(--bad)] px-2 py-1 text-xs text-[var(--bad)]">撕</button>
                      <button type="button" onClick={() => setConfirming(null)}
                        className="border-2 border-[var(--curb)] px-2 py-1 text-xs text-[var(--paper)]">留</button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-label={`删除贴纸：${m.topic}`}
                    onClick={() => setConfirming(m.id)}
                    className="absolute right-1 top-1 border border-[var(--curb)] bg-black px-1 text-xs text-[var(--bad)]"
                  >
                    ✕
                  </button>
                )
              )}
            </figure>
          ))}
        </div>
        {memes.length === 0 && !meme.loading && (
          <p className="py-16 text-center text-[13px] text-[var(--curb)]">册子还空着。它还没攒下第一张梗图。</p>
        )}
      </div>
    </div>
  );
}


export default function Page() {
  return (
    <Suspense>
      <StickerInner />
    </Suspense>
  );
}
